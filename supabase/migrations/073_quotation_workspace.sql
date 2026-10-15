-- Whole-document saves, optimistic locking, template fields and immutable PDFs.
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS workspace_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS document_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS specification text;
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS measurement_unit text;

CREATE TABLE IF NOT EXISTS public.quotation_documents (
  id uuid PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  workspace_version integer NOT NULL,
  revision integer NOT NULL,
  storage_path text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL
);
ALTER TABLE public.quotation_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotation_documents_access ON public.quotation_documents;
CREATE POLICY quotation_documents_access ON public.quotation_documents FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id));

CREATE OR REPLACE FUNCTION public.update_quotations_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  IF (to_jsonb(NEW) - ARRAY['updated_at','workspace_version','pdf_storage_path','status','revision'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','workspace_version','pdf_storage_path','status','revision']) THEN
    NEW.workspace_version = OLD.workspace_version + 1;
    NEW.pdf_storage_path = NULL;
  END IF;
  RETURN NEW;
END;
$$;

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
      OR (e->>'discountType'='fixed' AND (e->>'discountValue')::numeric>COALESCE((e->>'qty')::numeric,1)*COALESCE((e->>'unitPrice')::numeric,0)) ))) THEN RAISE EXCEPTION 'Invalid item values'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE NULLIF(e->>'parentItemId','') IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(p_items) parent WHERE parent->>'id'=e->>'parentItemId' AND parent->>'itemType'='line' AND NULLIF(parent->>'parentItemId','') IS NULL)) THEN RAISE EXCEPTION 'Invalid item parent'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'kind' IN ('Included','Optional') AND (NULLIF(e->>'parentItemId','') IS NULL OR COALESCE((e->>'discountValue')::numeric,0)<>0)) THEN RAISE EXCEPTION 'Invalid non-chargeable component'; END IF;
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
      COALESCE((e->>'qty')::numeric,1) * COALESCE((e->>'unitPrice')::numeric,0) -
      CASE e->>'discountType' WHEN 'percent' THEN COALESCE((e->>'qty')::numeric,1) * COALESCE((e->>'unitPrice')::numeric,0) * COALESCE((e->>'discountValue')::numeric,0)/100
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

-- Publish only if the generated content still matches the current saved version.
CREATE OR REPLACE FUNCTION public.publish_quotation_document(p_id uuid,p_version integer,p_document_id uuid,p_path text,p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotations;
BEGIN
  SELECT * INTO q FROM quotations WHERE id=p_id FOR UPDATE;
  IF q.id IS NULL OR NOT (is_account_member(q.account_id,'admin') OR (is_account_member(q.account_id,'agent') AND q.assigned_to=(SELECT id FROM profiles WHERE user_id=auth.uid()))) THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  IF p_version IS NULL OR q.workspace_version<>p_version THEN RAISE EXCEPTION 'Quotation changed. Generate the PDF again.' USING ERRCODE='40001'; END IF;
  IF p_path <> p_id::text || '/rev-' || q.revision::text || '-' || p_document_id::text || '.pdf' THEN RAISE EXCEPTION 'Invalid document path'; END IF;
  INSERT INTO quotation_documents(id,quotation_id,account_id,workspace_version,revision,storage_path,snapshot)
  VALUES(p_document_id,p_id,q.account_id,p_version,q.revision,p_path,p_snapshot);
  UPDATE quotations SET pdf_storage_path=p_path WHERE id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_quotation_document(uuid,integer,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_quotation_document(uuid,integer,uuid,text,jsonb) TO authenticated;

ALTER TABLE public.quotation_documents ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'ready';
ALTER TABLE public.quotation_documents ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.claim_quotation_send(p_document_id uuid,p_conversation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.quotation_documents; q public.quotations;
BEGIN
  -- Lock quotation before document, matching publish/save lock order.
  SELECT q1.* INTO q FROM quotations q1 JOIN quotation_documents d1 ON d1.quotation_id=q1.id WHERE d1.id=p_document_id FOR UPDATE OF q1;
  IF q.id IS NULL OR NOT (is_account_member(q.account_id,'admin') OR (is_account_member(q.account_id,'agent') AND q.assigned_to=(SELECT id FROM profiles WHERE user_id=auth.uid()))) THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  SELECT * INTO d FROM quotation_documents WHERE id=p_document_id FOR UPDATE;
  IF d.sent_at IS NOT NULL THEN RETURN jsonb_build_object('alreadySent',true,'messageId',d.message_id); END IF;
  IF d.send_state <> 'ready' THEN RAISE EXCEPTION 'Delivery could not be confirmed. Check the chat before sending again.' USING ERRCODE='40001'; END IF;
  IF d.workspace_version<>q.workspace_version OR q.pdf_storage_path IS DISTINCT FROM d.storage_path THEN RAISE EXCEPTION 'Quotation changed. Prepare the latest PDF.' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE c.id=p_conversation_id AND c.account_id=q.account_id
    AND regexp_replace(ct.phone,'[^0-9]','','g')=regexp_replace(q.client_phone,'[^0-9]','','g')) THEN RAISE EXCEPTION 'Quotation recipient does not match this conversation'; END IF;
  UPDATE quotation_documents SET send_state='sending',conversation_id=p_conversation_id WHERE id=p_document_id;
  RETURN jsonb_build_object('alreadySent',false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_quotation_send(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_quotation_send(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_quotation_send(p_document_id uuid,p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.quotation_documents;
BEGIN
  SELECT * INTO d FROM quotation_documents WHERE id=p_document_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM messages WHERE id=p_message_id AND conversation_id=d.conversation_id AND media_url LIKE '%' || d.storage_path || '%') THEN RAISE EXCEPTION 'Sent message does not match document'; END IF;
  UPDATE quotation_documents SET sent_at=COALESCE(sent_at,now()),message_id=p_message_id,send_state='sent' WHERE id=p_document_id;
  UPDATE quotations SET status='sent' WHERE id=d.quotation_id AND workspace_version=d.workspace_version AND status='draft';
END;
$$;
REVOKE ALL ON FUNCTION public.complete_quotation_send(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_quotation_send(uuid,uuid) TO service_role;
