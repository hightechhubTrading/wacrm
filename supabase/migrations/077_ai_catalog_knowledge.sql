-- Product families and reviewed evidence. Legacy rows remain approved.
BEGIN;
ALTER TABLE public.ai_products
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'product' CHECK (kind IN ('family','product','variant')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','approved')),
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specifications text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS limitations text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_notes text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS ai_products_account_id_id ON public.ai_products(account_id,id);
ALTER TABLE public.ai_products ADD CONSTRAINT ai_products_parent_account_fk
  FOREIGN KEY (account_id,parent_id) REFERENCES public.ai_products(account_id,id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS ai_products_parent_idx ON public.ai_products(account_id,parent_id);
-- Prevent cycles even for direct PostgREST writers. Serialize tree edits per account.
CREATE OR REPLACE FUNCTION public.check_ai_product_tree() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text, 77));
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_id FROM public.ai_products WHERE id=NEW.parent_id AND account_id=NEW.account_id
      UNION
      SELECT p.id,p.parent_id FROM public.ai_products p JOIN ancestors a ON p.id=a.parent_id
      WHERE p.account_id=NEW.account_id
    ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION 'A product cannot be its own ancestor' USING ERRCODE='23514'; END IF;
  IF NEW.kind='family' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'A family must be a root entry' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='variant' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'A variant needs a parent product' USING ERRCODE='23514';
  END IF;
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_products p WHERE p.id=NEW.parent_id AND p.account_id=NEW.account_id
    AND ((NEW.kind='product' AND p.kind='family') OR (NEW.kind='variant' AND p.kind='product'))
  ) THEN RAISE EXCEPTION 'Products belong to families; variants belong to products' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_products c WHERE c.parent_id=NEW.id AND c.account_id=NEW.account_id
    AND NOT ((NEW.kind='family' AND c.kind='product') OR (NEW.kind='product' AND c.kind='variant')))
  THEN RAISE EXCEPTION 'Move children before changing the entry type' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_ai_product_tree BEFORE INSERT OR UPDATE ON public.ai_products
  FOR EACH ROW EXECUTE FUNCTION public.check_ai_product_tree();
ALTER TABLE public.ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','approved')),
  ADD COLUMN IF NOT EXISTS topic text NOT NULL DEFAULT 'company' CHECK (topic IN ('company','product','service','policy')),
  ADD COLUMN IF NOT EXISTS product_id uuid,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_notes text NOT NULL DEFAULT '';
ALTER TABLE public.ai_knowledge_documents ADD CONSTRAINT ai_knowledge_product_account_fk
  FOREIGN KEY (account_id,product_id) REFERENCES public.ai_products(account_id,id) ON DELETE RESTRICT;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_handoff_reason jsonb;
CREATE OR REPLACE FUNCTION public.ai_product_is_approved(p_id uuid,p_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
 WITH RECURSIVE chain AS (
   SELECT id,parent_id,status FROM public.ai_products WHERE id=p_id AND account_id=p_account
   UNION
   SELECT p.id,p.parent_id,p.status FROM public.ai_products p JOIN chain c ON p.id=c.parent_id WHERE p.account_id=p_account
 ) SELECT count(*)>0 AND bool_and(status='approved') FROM chain;
$$;
REVOKE ALL ON FUNCTION public.ai_product_is_approved(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_product_is_approved(uuid,uuid) TO authenticated,service_role;
-- Both retrieval paths enforce review status and retain invoker/RLS boundaries.
-- Source IDs travel with excerpts so generation and verification see identical evidence.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(p_account_id uuid,p_query text,p_match_count integer)
RETURNS TABLE(id uuid,content text,rank real) LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public AS $$
 SELECT c.id, '[source document='||d.id::text||' chunk='||c.id::text||'] '||d.title||E'\n'||
   CASE WHEN d.source_url IS NULL THEN '' ELSE 'Source: '||d.source_url||E'\n' END||c.content,
   ts_rank(c.fts,websearch_to_tsquery('simple',regexp_replace(p_query,'\s+',' OR ','g'))) AS rank
 FROM public.ai_knowledge_chunks c JOIN public.ai_knowledge_documents d ON d.id=c.document_id AND d.account_id=c.account_id
 WHERE c.account_id=p_account_id AND d.status='approved'
 AND (d.product_id IS NULL OR public.ai_product_is_approved(d.product_id,p_account_id))
 AND c.fts @@ websearch_to_tsquery('simple',regexp_replace(p_query,'\s+',' OR ','g'))
 ORDER BY rank DESC LIMIT LEAST(GREATEST(p_match_count,0),20);
$$;
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid,p_query_embedding text,p_match_count integer)
RETURNS TABLE(id uuid,content text,distance real) LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public,extensions AS $$
 SELECT c.id, '[source document='||d.id::text||' chunk='||c.id::text||'] '||d.title||E'\n'||
   CASE WHEN d.source_url IS NULL THEN '' ELSE 'Source: '||d.source_url||E'\n' END||c.content,
   (c.embedding <=> p_query_embedding::vector(1536))::real
 FROM public.ai_knowledge_chunks c JOIN public.ai_knowledge_documents d ON d.id=c.document_id AND d.account_id=c.account_id
 WHERE c.account_id=p_account_id AND d.status='approved' AND c.embedding IS NOT NULL
 AND (d.product_id IS NULL OR public.ai_product_is_approved(d.product_id,p_account_id))
 ORDER BY c.embedding <=> p_query_embedding::vector(1536) LIMIT LEAST(GREATEST(p_match_count,0),20);
$$;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid,text,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid,text,integer) TO authenticated,service_role;
-- Existing HTH window catalog notes explicitly identify square metres. Preserve values.
UPDATE public.ai_products SET price_unit='per_square_meter'
WHERE id='b281fe23-26af-4509-a01c-cbb8546c6e22'
  AND account_id='21e37548-cb15-46e6-8556-510f47a538be'
  AND price_unit='per_meter' AND price_min=350 AND price_max=380
  AND price_notes LIKE '%سعر المتر المربع%';
-- Atomic, repeatable research import. Existing entries/prices are never overwritten.
CREATE OR REPLACE FUNCTION public.import_ai_catalog_drafts(p_account_id uuid,p_entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE entry jsonb; parent_uuid uuid; entry_uuid uuid; ids jsonb := '{}'; added integer := 0;
BEGIN
 IF NOT public.is_account_member(p_account_id,'admin') THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries)>100 THEN RAISE EXCEPTION 'Invalid catalog entries'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text,77));
 FOR entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
   parent_uuid := CASE WHEN entry->>'parent_key' IS NULL THEN NULL ELSE (ids->>(entry->>'parent_key'))::uuid END;
   IF entry->>'parent_key' IS NOT NULL AND parent_uuid IS NULL THEN RAISE EXCEPTION 'Missing parent'; END IF;
   SELECT id INTO entry_uuid FROM public.ai_products WHERE account_id=p_account_id AND name=entry->>'name' ORDER BY created_at LIMIT 1;
   IF entry_uuid IS NULL THEN
     INSERT INTO public.ai_products(account_id,created_by,name,description,kind,parent_id,status,aliases,source_url,source_notes,limitations)
     VALUES(p_account_id,auth.uid(),entry->>'name',entry->>'description',entry->>'kind',parent_uuid,'draft',
       ARRAY(SELECT jsonb_array_elements_text(entry->'aliases')),entry->>'source_url',entry->>'source_notes',
       'Confirm exact scope, warranty, motor, installation timing and pricing with the team. No price or technical rating is inherited from another entry.') RETURNING id INTO entry_uuid;
     added := added+1;
   END IF;
   ids := ids || jsonb_build_object(entry->>'key',entry_uuid);
 END LOOP;
 RETURN added;
END $$;
REVOKE ALL ON FUNCTION public.import_ai_catalog_drafts(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_ai_catalog_drafts(uuid,jsonb) TO authenticated;
COMMIT;
