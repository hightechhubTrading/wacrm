-- Optional, single quotation picture. Files are immutable and private.
-- Registry rows survive quotation deletion until the object is cleaned up.
CREATE TABLE public.quotation_images (
 storage_path text PRIMARY KEY,
 quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
 account_id uuid NOT NULL,
 image jsonb NOT NULL,
 ready boolean NOT NULL DEFAULT false,
 deleting boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (image->>'storagePath'=storage_path),
 CHECK (quotation_id IS NULL OR split_part(storage_path,'/',1)=quotation_id::text)
);
CREATE INDEX quotation_images_cleanup_idx ON public.quotation_images(created_at);
CREATE INDEX quotation_images_quotation_idx ON public.quotation_images(quotation_id);
ALTER TABLE public.quotation_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quotation_images FROM anon,authenticated;
GRANT SELECT ON public.quotation_images TO authenticated;
GRANT ALL ON public.quotation_images TO service_role;
CREATE POLICY quotation_images_select ON public.quotation_images FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id=quotation_id AND q.account_id=quotation_images.account_id));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('quotation-images','quotation-images',false,5242880,ARRAY['image/jpeg'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=ARRAY['image/jpeg'];
-- No client storage policies: authenticated application endpoints authorize reads and uploads.

CREATE FUNCTION public.quotation_reference_image_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k text;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>5 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) x WHERE x NOT IN ('storagePath','mimeType','bytes','width','height')) THEN RETURN false;END IF;
 IF jsonb_typeof(p->'storagePath') IS DISTINCT FROM 'string' OR p->>'storagePath' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$' OR p->>'mimeType' IS DISTINCT FROM 'image/jpeg' THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['bytes','width','height'] LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'number' OR (p->>k)::numeric<>trunc((p->>k)::numeric) OR (p->>k)::numeric NOT BETWEEN 1 AND (CASE WHEN k='bytes' THEN 5242880 ELSE 2400 END) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;
ALTER TABLE public.quotation_images ADD CONSTRAINT quotation_images_metadata_valid CHECK(public.quotation_reference_image_valid(image));
ALTER FUNCTION public.quotation_document_details_valid(jsonb) RENAME TO quotation_document_details_valid_v094;
CREATE FUNCTION public.quotation_document_details_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT public.quotation_document_details_valid_v094(p-'referenceImage')
 AND (NOT(p?'referenceImage') OR public.quotation_reference_image_valid(p->'referenceImage'));
$$;
REVOKE ALL ON FUNCTION public.quotation_reference_image_valid(jsonb),public.quotation_document_details_valid(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quotation_reference_image_valid(jsonb),public.quotation_document_details_valid(jsonb) TO authenticated,service_role;

-- Lock the registry row through commit, serializing saves/publication against cleanup.
CREATE FUNCTION public.assert_quotation_reference_image(p_quotation uuid,p_account uuid,p_image jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE found_image jsonb;
BEGIN
 IF NOT public.quotation_reference_image_valid(p_image) THEN RAISE EXCEPTION 'referenceImageInvalid' USING ERRCODE='22023'; END IF;
 SELECT image INTO found_image FROM public.quotation_images
 WHERE storage_path=p_image->>'storagePath' AND quotation_id=p_quotation AND account_id=p_account AND ready AND NOT deleting FOR SHARE;
 IF found_image IS NULL OR found_image<>p_image THEN RAISE EXCEPTION 'referenceImageInvalid' USING ERRCODE='22023';END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_quotation_reference_image(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.check_quotation_reference_image() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE picture jsonb; qid uuid;
BEGIN
 IF TG_TABLE_NAME='quotations' THEN picture:=NEW.document_details->'referenceImage';qid:=NEW.id;
 ELSE picture:=NEW.snapshot->'documentDetails'->'referenceImage';qid:=NEW.quotation_id; END IF;
 IF picture IS NOT NULL THEN PERFORM public.assert_quotation_reference_image(qid,NEW.account_id,picture);END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.check_quotation_reference_image() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER quotation_reference_image_check BEFORE INSERT OR UPDATE OF document_details,account_id ON public.quotations
 FOR EACH ROW EXECUTE FUNCTION public.check_quotation_reference_image();
CREATE TRIGGER quotation_document_reference_image_check BEFORE INSERT OR UPDATE OF snapshot,account_id,quotation_id ON public.quotation_documents
 FOR EACH ROW EXECUTE FUNCTION public.check_quotation_reference_image();
CREATE INDEX quotations_reference_image_idx ON public.quotations ((document_details->'referenceImage'->>'storagePath'));
CREATE INDEX quotation_documents_reference_image_idx ON public.quotation_documents ((snapshot->'documentDetails'->'referenceImage'->>'storagePath'));

-- Two-stage deletion: mark first, remove storage object, then delete registry row.
-- Failed storage removals remain marked for retry. A marked image cannot be attached.
CREATE FUNCTION public.claim_unused_quotation_images() RETURNS SETOF public.quotation_images
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE candidate public.quotation_images;
BEGIN
 FOR candidate IN SELECT i.* FROM public.quotation_images i WHERE i.created_at<now()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM public.quotations q WHERE q.document_details->'referenceImage'->>'storagePath'=i.storage_path)
  AND NOT EXISTS(SELECT 1 FROM public.quotation_documents d WHERE d.snapshot->'documentDetails'->'referenceImage'->>'storagePath'=i.storage_path)
  ORDER BY i.created_at LIMIT 100 FOR UPDATE OF i SKIP LOCKED LOOP
  IF NOT EXISTS(SELECT 1 FROM public.quotations q WHERE q.document_details->'referenceImage'->>'storagePath'=candidate.storage_path)
   AND NOT EXISTS(SELECT 1 FROM public.quotation_documents d WHERE d.snapshot->'documentDetails'->'referenceImage'->>'storagePath'=candidate.storage_path) THEN
    UPDATE public.quotation_images SET deleting=true WHERE storage_path=candidate.storage_path RETURNING * INTO candidate;
    RETURN NEXT candidate;
  END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.claim_unused_quotation_images() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_unused_quotation_images() TO service_role;
CREATE FUNCTION public.quotation_images_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM storage.buckets WHERE id='quotation-images' AND NOT public AND file_size_limit=5242880 AND allowed_mime_types=ARRAY['image/jpeg'])
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.quotation_images'::regclass)
 AND NOT has_table_privilege('authenticated','public.quotation_images','INSERT,UPDATE,DELETE')
 AND NOT has_function_privilege('authenticated','public.claim_unused_quotation_images()','EXECUTE')
 AND has_function_privilege('service_role','public.claim_unused_quotation_images()','EXECUTE')
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.quotations'::regclass AND tgname='quotation_reference_image_check' AND tgenabled='O')
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.quotation_documents'::regclass AND tgname='quotation_document_reference_image_check' AND tgenabled='O');
$$;
REVOKE ALL ON FUNCTION public.quotation_images_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quotation_images_ready() TO service_role;

NOTIFY pgrst,'reload schema';
