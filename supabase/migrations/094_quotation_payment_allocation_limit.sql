-- Enforce the total allocation at the persistence boundary, including older clients.
CREATE OR REPLACE FUNCTION public.quotation_document_details_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE allocated numeric := 0; plan jsonb; stage jsonb; entry jsonb; opt jsonb; k text; value jsonb;
BEGIN
 IF NOT public.quotation_document_details_valid_v092(p-'paymentPlan'-'itemOptions'-'formatVersion') THEN RETURN false; END IF;
 IF p?'formatVersion' AND p->'formatVersion'<>'2'::jsonb THEN RETURN false;END IF;
 IF p?'paymentPlan' THEN
  plan:=p->'paymentPlan';
  IF jsonb_typeof(plan) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(plan) x WHERE x NOT IN ('stages','notes')) OR jsonb_typeof(plan->'stages') IS DISTINCT FROM 'array' OR jsonb_array_length(plan->'stages') NOT BETWEEN 1 AND 12 THEN RETURN false;END IF;
  IF plan?'notes' AND (jsonb_typeof(plan->'notes')<>'string' OR length(plan->>'notes')>10000) THEN RETURN false;END IF;
  FOR stage IN SELECT * FROM jsonb_array_elements(plan->'stages') LOOP
   IF jsonb_typeof(stage)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(stage) x WHERE x NOT IN ('percent','event','label')) OR jsonb_typeof(stage->'percent') IS DISTINCT FROM 'number' OR (stage->>'percent')::numeric NOT BETWEEN 0 AND 100 OR stage->>'event' IS NULL OR stage->>'event' NOT IN ('acceptance','before_installation','delivery','completion','custom','unspecified') THEN RETURN false;END IF;
   IF stage?'label' AND (jsonb_typeof(stage->'label')<>'string' OR length(stage->>'label')>1000) THEN RETURN false;END IF;
   allocated := allocated + (stage->>'percent')::numeric;
  END LOOP;
  IF allocated > 100.00000001 THEN RETURN false; END IF;
 END IF;
 IF p?'itemOptions' THEN
  IF jsonb_typeof(p->'itemOptions') IS DISTINCT FROM 'object' OR length((p->'itemOptions')::text)>1000000 THEN RETURN false;END IF;
  FOR k,entry IN SELECT * FROM jsonb_each(p->'itemOptions') LOOP
   IF k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(entry)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) x WHERE x NOT IN ('drawingReference','selections')) THEN RETURN false;END IF;
   IF entry?'drawingReference' AND (jsonb_typeof(entry->'drawingReference')<>'string' OR length(entry->>'drawingReference')>1000) THEN RETURN false;END IF;
   IF entry?'selections' THEN
    IF jsonb_typeof(entry->'selections')<>'object' THEN RETURN false;END IF;
    FOR k,value IN SELECT * FROM jsonb_each(entry->'selections') LOOP
     IF length(k)>100 OR jsonb_typeof(value)<>'string' OR length(value#>>'{}')>1000 THEN RETURN false;END IF;
    END LOOP;
   END IF;
  END LOOP;
 END IF;
 IF p?'paymentSchedule' AND coalesce((p->'paymentSchedule'->>'advance')::numeric,0)+coalesce((p->'paymentSchedule'->>'delivery')::numeric,0)+coalesce((p->'paymentSchedule'->>'completion')::numeric,0)>100.00000001 THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.quotation_document_details_valid(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quotation_document_details_valid(jsonb) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';

