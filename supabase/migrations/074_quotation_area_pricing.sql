-- Square-metre pricing uses the physical area of each opening, not its count.
-- Existing item quantities/units remain intact; no customer records are rewritten.
CREATE OR REPLACE FUNCTION public.quotation_billable_quantity(
  p_qty numeric, p_unit text, p_width numeric, p_height numeric, p_measure text
) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT COALESCE(p_qty,1) * CASE WHEN p_unit='m2' THEN
    COALESCE(p_width,0) * COALESCE(p_height,0) /
    CASE COALESCE(p_measure,'mm') WHEN 'm' THEN 1 WHEN 'cm' THEN 10000 ELSE 1000000 END
  ELSE 1 END
$$;
REVOKE ALL ON FUNCTION public.quotation_billable_quantity(numeric,text,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quotation_billable_quantity(numeric,text,numeric,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_quotation_workspace(
  p_id uuid, p_version integer, p_fields jsonb, p_items jsonb, p_revise boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.quotations;
  v_subtotal numeric := 0;
  v_total numeric;
BEGIN
  SELECT * INTO q FROM public.quotations WHERE id = p_id FOR UPDATE;
  IF q.id IS NULL OR NOT (is_account_member(q.account_id, 'admin') OR
    (is_account_member(q.account_id, 'agent') AND q.assigned_to = (SELECT id FROM profiles WHERE user_id = auth.uid()))) THEN
    RAISE EXCEPTION 'Quotation not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_version IS NULL OR q.workspace_version <> p_version THEN
    RAISE EXCEPTION 'Quotation changed. Reload before saving.' USING ERRCODE = '40001';
  END IF;
  IF q.status <> 'draft' AND NOT p_revise THEN
    RAISE EXCEPTION 'Create a revision before editing this quotation.';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 300 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  IF NULLIF(p_fields->>'contact_id','') IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM contacts WHERE id = (p_fields->>'contact_id')::uuid AND account_id = q.account_id) THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF NULLIF(p_fields->>'deal_id','') IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM deals WHERE id = (p_fields->>'deal_id')::uuid AND account_id = q.account_id) THEN RAISE EXCEPTION 'Deal not found'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE NULLIF(e->>'productId','') IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM catalog_items c WHERE c.id = (e->>'productId')::uuid AND c.account_id = q.account_id)) THEN RAISE EXCEPTION 'Catalog item not found'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'itemType' NOT IN ('line','section')
    OR (e->>'itemType'='line' AND (COALESCE((e->>'qty')::numeric,0)<=0 OR COALESCE((e->>'unitPrice')::numeric,0)<0
      OR COALESCE((e->>'discountValue')::numeric,0)<0 OR (e->>'discountType'='percent' AND (e->>'discountValue')::numeric>100)
      OR (e->>'discountType'='fixed' AND (e->>'discountValue')::numeric>public.quotation_billable_quantity(COALESCE((e->>'qty')::numeric,1), e->>'unit', (e->>'sizeW')::numeric, (e->>'sizeH')::numeric, e->>'measurementUnit')*COALESCE((e->>'unitPrice')::numeric,0)) ))) THEN RAISE EXCEPTION 'Invalid item values'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE NULLIF(e->>'parentItemId','') IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(p_items) parent WHERE parent->>'id'=e->>'parentItemId' AND parent->>'itemType'='line' AND NULLIF(parent->>'parentItemId','') IS NULL)) THEN RAISE EXCEPTION 'Invalid item parent'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'kind' IN ('Included','Optional') AND (NULLIF(e->>'parentItemId','') IS NULL OR COALESCE((e->>'discountValue')::numeric,0)<>0)) THEN RAISE EXCEPTION 'Invalid non-chargeable component'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'itemType'='line' AND (
    (e->>'unit'='m2' AND COALESCE(e->>'measurementUnit','mm') NOT IN ('mm','cm','m'))
    OR COALESCE((e->>'sizeW')::numeric,0)<0 OR COALESCE((e->>'sizeH')::numeric,0)<0
    OR COALESCE((e->>'sizeW')::numeric,0)::text IN ('NaN','Infinity','-Infinity')
    OR COALESCE((e->>'sizeH')::numeric,0)::text IN ('NaN','Infinity','-Infinity')
    OR public.quotation_billable_quantity(COALESCE((e->>'qty')::numeric,1), e->>'unit', (e->>'sizeW')::numeric, (e->>'sizeH')::numeric, e->>'measurementUnit') * COALESCE((e->>'unitPrice')::numeric,0) > 1000000000000
  )) THEN RAISE EXCEPTION 'Invalid dimensions or amount'; END IF;
  -- Reject foreign item IDs before the upsert/delete work, even for admins.
  IF EXISTS (SELECT 1 FROM quotation_items i JOIN jsonb_array_elements(p_items) e ON i.id = (e->>'id')::uuid WHERE i.quotation_id <> p_id) THEN RAISE EXCEPTION 'Invalid item owner'; END IF;
  DELETE FROM quotation_items WHERE quotation_id = p_id;
  INSERT INTO quotation_items(id, quotation_id, account_id, parent_item_id, product_id, position,
    item_type, kind, item_code, description, description_ar, size_w, size_h, qty, unit_price,
    discount_type, discount_value, line_total, specification, unit, measurement_unit)
  SELECT (e->>'id')::uuid, p_id, q.account_id, NULLIF(e->>'parentItemId','')::uuid, NULLIF(e->>'productId','')::uuid,
    ordinality - 1, e->>'itemType', e->>'kind', e->>'itemCode', e->>'description', e->>'descriptionAr',
    (e->>'sizeW')::numeric, (e->>'sizeH')::numeric, COALESCE((e->>'qty')::numeric,1), (e->>'unitPrice')::numeric,
    e->>'discountType', (e->>'discountValue')::numeric,
    CASE WHEN e->>'itemType' = 'section' OR e->>'kind' IN ('Included','Optional') THEN 0 ELSE round(GREATEST(0,
      public.quotation_billable_quantity(COALESCE((e->>'qty')::numeric,1), e->>'unit', (e->>'sizeW')::numeric, (e->>'sizeH')::numeric, e->>'measurementUnit') * COALESCE((e->>'unitPrice')::numeric,0) -
      CASE e->>'discountType' WHEN 'percent' THEN public.quotation_billable_quantity(COALESCE((e->>'qty')::numeric,1), e->>'unit', (e->>'sizeW')::numeric, (e->>'sizeH')::numeric, e->>'measurementUnit') * COALESCE((e->>'unitPrice')::numeric,0) * COALESCE((e->>'discountValue')::numeric,0)/100
      WHEN 'fixed' THEN COALESCE((e->>'discountValue')::numeric,0) ELSE 0 END),2) END,
    e->>'specification', e->>'unit', e->>'measurementUnit'
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS a(e, ordinality);
  SELECT COALESCE(sum(line_total),0) INTO v_subtotal FROM quotation_items WHERE quotation_id = p_id;
  IF COALESCE((p_fields->>'discount_value')::numeric,0)<0 OR (p_fields->>'discount_type'='percent' AND (p_fields->>'discount_value')::numeric>100) OR (p_fields->>'discount_type'='fixed' AND (p_fields->>'discount_value')::numeric>v_subtotal) THEN RAISE EXCEPTION 'Invalid quotation discount'; END IF;
  v_total := round(GREATEST(0, v_subtotal - CASE p_fields->>'discount_type'
    WHEN 'percent' THEN v_subtotal * COALESCE((p_fields->>'discount_value')::numeric,0)/100
    WHEN 'fixed' THEN COALESCE((p_fields->>'discount_value')::numeric,0) ELSE 0 END),2);
  UPDATE quotations SET client_name=p_fields->>'client_name', client_phone=p_fields->>'client_phone',
    client_company=p_fields->>'client_company', location=p_fields->>'location', project_name=p_fields->>'project_name',
    subject=p_fields->>'subject', valid_until=NULLIF(p_fields->>'valid_until','')::date,
    contact_id=NULLIF(p_fields->>'contact_id','')::uuid, deal_id=NULLIF(p_fields->>'deal_id','')::uuid,
    delivery_terms=p_fields->>'delivery_terms', payment_terms=p_fields->>'payment_terms', warranty_terms=p_fields->>'warranty_terms',
    document_details=COALESCE(p_fields->'document_details','{}'::jsonb), discount_type=p_fields->>'discount_type',
    discount_value=(p_fields->>'discount_value')::numeric, subtotal=v_subtotal, discount_amount=v_subtotal-v_total, total=v_total,
    revision=CASE WHEN p_revise AND q.status <> 'draft' THEN q.revision+1 ELSE q.revision END,
    status='draft', pdf_storage_path=NULL, workspace_version=q.workspace_version+1
  WHERE id=p_id;
  -- A line-only change must increment version even if totals and fields match.
  UPDATE quotations SET workspace_version=q.workspace_version+1 WHERE id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_quotation_workspace(uuid,integer,jsonb,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quotation_workspace(uuid,integer,jsonb,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION save_quotation_items(
  p_quotation_id uuid,
  p_account_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT q.account_id INTO v_account_id
  FROM quotations q
  WHERE q.id = p_quotation_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Quotation not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM quotation_items WHERE quotation_id = p_quotation_id;

  INSERT INTO quotation_items (
    id, quotation_id, account_id, parent_item_id, product_id, position,
    item_type, kind, item_code, description, description_ar,
    size_w, size_h, qty, unit_price, discount_type, discount_value, line_total, specification, unit, measurement_unit
  )
  SELECT
    (elem->>'id')::uuid,
    p_quotation_id,
    v_account_id,
    NULLIF(elem->>'parent_item_id', '')::uuid,
    NULLIF(elem->>'product_id', '')::uuid,
    (elem->>'position')::integer,
    elem->>'item_type',
    elem->>'kind',
    elem->>'item_code',
    elem->>'description',
    elem->>'description_ar',
    (elem->>'size_w')::numeric,
    (elem->>'size_h')::numeric,
    COALESCE((elem->>'qty')::numeric, 1),
    (elem->>'unit_price')::numeric,
    elem->>'discount_type',
    (elem->>'discount_value')::numeric,
    COALESCE((elem->>'line_total')::numeric, 0),
    elem->>'specification', elem->>'unit', elem->>'measurement_unit'
  FROM jsonb_array_elements(p_items) AS elem;

  UPDATE quotations
  SET subtotal = p_subtotal, discount_amount = p_discount_amount, total = p_total
  WHERE id = p_quotation_id;
END;
$$;
