-- Creation uses a persisted one-item draft seed. The first workspace save consumes
-- it into quotation_items. Source knowledge must survive that same save.
CREATE FUNCTION public.quotation_document_details_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k text; v jsonb; part jsonb; item jsonb; n numeric;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p) LOOP
  IF k IN ('consultant','subjectAr','included','excluded','notes','preparedBy','repPhone','commercialPreset') THEN
   IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>10000 THEN RETURN false; END IF;
  ELSIF k='shopDrawingDays' THEN
   IF jsonb_typeof(v)<>'number' THEN RETURN false; END IF;
   n:=(v#>>'{}')::numeric; IF n<0 OR trunc(n)<>n THEN RETURN false; END IF;
  ELSIF k='paymentSchedule' THEN
   IF jsonb_typeof(v)<>'object' THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['advance','delivery','completion'] LOOP
    part:=v->k;IF jsonb_typeof(part) IS DISTINCT FROM 'number' THEN RETURN false;END IF;
    n:=(part#>>'{}')::numeric;IF n<0 OR n>100 THEN RETURN false;END IF;
   END LOOP;
   IF v?'deliveryTrigger' AND (jsonb_typeof(v->'deliveryTrigger') IS DISTINCT FROM 'string' OR v->>'deliveryTrigger' NOT IN ('before_installation','on_delivery')) THEN RETURN false; END IF;
  ELSIF k='knowledge' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'prices') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'references') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) x WHERE x NOT IN ('prices','references','manualOverrides','costEstimates')) THEN RETURN false;END IF;
   IF jsonb_array_length(v->'references')>1000 OR length(v::text)>4000000 THEN RETURN false;END IF;
   IF v?'manualOverrides' AND (jsonb_typeof(v->'manualOverrides')<>'array' OR jsonb_array_length(v->'manualOverrides')>300) THEN RETURN false;END IF;
   IF v?'costEstimates' AND jsonb_typeof(v->'costEstimates')<>'object' THEN RETURN false;END IF;
  ELSIF k='catalogueSeed' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) x WHERE x<>'item') THEN RETURN false;END IF;
   item:=v->'item';IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) x WHERE x NOT IN ('id','productId','itemCode','itemType','description','descriptionAr','specification','unit','measurementUnit','qty','kind','unitPrice')) THEN RETURN false;END IF;
   IF item->>'itemType' IS DISTINCT FROM 'line' OR coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR coalesce(item->>'productId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false;END IF;
   IF jsonb_typeof(item->'description') IS DISTINCT FROM 'string' OR length(trim(item->>'description')) NOT BETWEEN 1 AND 10000 THEN RETURN false;END IF;
   FOR k,part IN SELECT * FROM jsonb_each(item) LOOP
    IF k IN ('id','productId','itemCode','description','descriptionAr','specification','unit','measurementUnit','kind','itemType') AND (jsonb_typeof(part)<>'string' OR length(part#>>'{}')>10000) THEN RETURN false;END IF;
   END LOOP;
   IF jsonb_typeof(item->'qty') IS DISTINCT FROM 'number' THEN RETURN false;END IF;
   n:=(item->>'qty')::numeric;IF n<0 OR n>1000000 THEN RETURN false;END IF;
   IF item?'unitPrice' THEN IF jsonb_typeof(item->'unitPrice')<>'number' OR (item->>'unitPrice')::numeric<0 OR (item->>'unitPrice')::numeric>1000000000 THEN RETURN false;END IF;END IF;
   IF item?'measurementUnit' AND item->>'measurementUnit' NOT IN ('mm','cm','m') THEN RETURN false;END IF;
   IF item?'kind' AND item->>'kind'<>'Service' THEN RETURN false;END IF;
  ELSE RETURN false;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.quotation_document_details_valid(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quotation_document_details_valid(jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_quotation_document_details() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT public.quotation_document_details_valid(NEW.document_details) THEN RAISE EXCEPTION 'Invalid or unknown document detail' USING ERRCODE='22023';END IF;
 IF NEW.document_details?'catalogueSeed' THEN
  IF NEW.status<>'draft' OR NEW.workspace_version<>0 THEN RAISE EXCEPTION 'Catalogue seeds belong only to new drafts' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_products p WHERE p.id=(NEW.document_details->'catalogueSeed'->'item'->>'productId')::uuid AND p.account_id=NEW.account_id AND p.status='approved' AND p.superseded_by IS NULL AND p.kind<>'family') THEN RAISE EXCEPTION 'Catalogue seed product not found in this account' USING ERRCODE='23503';END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_quotation_document_details() FROM PUBLIC,anon,authenticated;
