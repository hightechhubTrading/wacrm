-- Customer guides live once in the knowledge library and can serve a product branch.
BEGIN;
ALTER TABLE public.ai_knowledge_documents
 ADD COLUMN document_type text NOT NULL DEFAULT 'reference' CHECK(document_type IN ('reference','customer_guide')),
 ADD COLUMN guide_sections jsonb;
ALTER TABLE public.ai_knowledge_documents ADD CONSTRAINT guide_shape CHECK(
 (document_type='reference' AND guide_sections IS NULL) OR
 (document_type='customer_guide' AND product_id IS NOT NULL AND NOT collection_only AND jsonb_typeof(guide_sections)='object')
);
CREATE UNIQUE INDEX one_customer_guide_per_product ON public.ai_knowledge_documents(account_id,product_id) WHERE document_type='customer_guide';
CREATE FUNCTION public.prepare_ai_customer_guide() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE k text; body text; headings jsonb := '{"explanation":"Explain simply","options":"Compare options","selection":"Help choose","next_question":"Useful next question","faq":"Common questions"}';
BEGIN
 IF NEW.document_type<>'customer_guide' THEN RETURN NEW; END IF;
 IF NEW.topic<>'product' OR NEW.product_id IS NULL OR NEW.collection_only OR jsonb_typeof(NEW.guide_sections) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'A customer guide needs a product link and structured sections' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.guide_sections) AS keys(k) WHERE NOT keys.k=ANY(ARRAY['explanation','options','selection','next_question','faq'])) THEN
  RAISE EXCEPTION 'Unknown guide section' USING ERRCODE='23514';
 END IF;
 body := 'GENERAL PRODUCT EDUCATION: category meanings and conditional buying guidance. This guide does not establish company availability, exact specifications, prices, warranties, performance ratings or delivery commitments. Use approved exact-product facts for company-specific claims.';
 FOREACH k IN ARRAY ARRAY['explanation','options','selection','next_question','faq'] LOOP
  IF jsonb_typeof(NEW.guide_sections->k) IS DISTINCT FROM 'string' OR length(NEW.guide_sections->>k)>6000 OR
   ((k='explanation' OR NEW.status='approved') AND length(trim(NEW.guide_sections->>k))=0) THEN
   RAISE EXCEPTION 'Complete the guide sections before approval' USING ERRCODE='23514';
  END IF;
  NEW.guide_sections := jsonb_set(NEW.guide_sections,ARRAY[k],to_jsonb(trim(NEW.guide_sections->>k)));
  body := body||E'\n\n## '||(headings->>k)||E'\n'||(NEW.guide_sections->>k);
 END LOOP;
 NEW.content := body;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_guide_content BEFORE INSERT OR UPDATE ON public.ai_knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.prepare_ai_customer_guide();
-- Section edits change generated content even when a client does not send content.
CREATE OR REPLACE FUNCTION public.invalidate_ai_document_search() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF OLD.content IS DISTINCT FROM NEW.content OR NEW.status='draft' OR NEW.collection_only OR
  OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.product_id IS DISTINCT FROM NEW.product_id THEN
  DELETE FROM public.ai_knowledge_chunks WHERE document_id=NEW.id AND account_id=NEW.account_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guide_search_invalidate AFTER UPDATE OF guide_sections,document_type,product_id ON public.ai_knowledge_documents
 FOR EACH ROW EXECUTE FUNCTION public.invalidate_ai_document_search();
-- Approval of education does not approve the company's product or inherit its facts.
CREATE FUNCTION public.ai_product_is_current(p_id uuid,p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH RECURSIVE chain AS (
  SELECT id,parent_id,superseded_by FROM public.ai_products WHERE id=p_id AND account_id=p_account
  UNION SELECT p.id,p.parent_id,p.superseded_by FROM public.ai_products p JOIN chain c ON p.id=c.parent_id WHERE p.account_id=p_account
 ) SELECT count(*)>0 AND bool_and(superseded_by IS NULL) AND bool_or(parent_id IS NULL) FROM chain;
$$;
CREATE FUNCTION public.ai_knowledge_document_is_approved(p_id uuid,p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT coalesce((SELECT d.status='approved' AND NOT d.collection_only AND
  CASE WHEN d.document_type='customer_guide' THEN public.ai_product_is_current(d.product_id,p_account)
   ELSE d.product_id IS NULL OR public.ai_product_is_approved(d.product_id,p_account) END
 FROM public.ai_knowledge_documents d WHERE d.id=p_id AND d.account_id=p_account),false);
$$;
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(p_account_id uuid,p_query text,p_match_count integer)
RETURNS TABLE(id uuid,content text,rank real) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH query AS (SELECT websearch_to_tsquery('simple',regexp_replace(p_query,'\s+',' OR ','g')) q), matches AS (
 SELECT c.id,'[source document='||d.id::text||' chunk='||c.id::text||'] '||d.title||E'\n'||CASE WHEN d.document_type='customer_guide' THEN '[knowledge_type=customer_guide] GENERAL EDUCATION ONLY; not company availability or exact specifications.'||E'\n' ELSE '' END||
 CASE WHEN d.source_url IS NULL THEN '' ELSE 'Source: '||d.source_url||E'\n' END||c.content content,ts_rank(c.fts,q.q) rank,'document:'||d.id::text source_key
 FROM public.ai_knowledge_chunks c JOIN public.ai_knowledge_documents d ON d.id=c.document_id AND d.account_id=c.account_id CROSS JOIN query q
 WHERE c.account_id=p_account_id AND public.ai_knowledge_document_is_approved(d.id,p_account_id) AND c.fts@@q.q
 UNION ALL
 SELECT c.id,'[source product='||p.id::text||' chunk='||c.id::text||'] '||c.content,ts_rank(c.fts,q.q),'product:'||p.id::text
 FROM public.ai_product_search_chunks c JOIN public.ai_products p ON p.id=c.product_id AND p.account_id=c.account_id CROSS JOIN query q
 WHERE c.account_id=p_account_id AND public.ai_product_is_approved(p.id,p_account_id) AND c.fts@@q.q
 ), diverse AS (SELECT *,row_number() OVER(PARTITION BY source_key ORDER BY rank DESC,id) source_rank FROM matches) SELECT id,content,rank FROM diverse WHERE source_rank<=2 ORDER BY rank DESC,id LIMIT LEAST(GREATEST(p_match_count,0),20);
$$;
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid,p_query_embedding text,p_match_count integer)
RETURNS TABLE(id uuid,content text,distance real) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions AS $$
 WITH matches AS (
 SELECT c.id,'[source document='||d.id::text||' chunk='||c.id::text||'] '||d.title||E'\n'||CASE WHEN d.document_type='customer_guide' THEN '[knowledge_type=customer_guide] GENERAL EDUCATION ONLY; not company availability or exact specifications.'||E'\n' ELSE '' END||
 CASE WHEN d.source_url IS NULL THEN '' ELSE 'Source: '||d.source_url||E'\n' END||c.content content,(c.embedding<=>p_query_embedding::vector(1536))::real distance,'document:'||d.id::text source_key
 FROM public.ai_knowledge_chunks c JOIN public.ai_knowledge_documents d ON d.id=c.document_id AND d.account_id=c.account_id
 WHERE c.account_id=p_account_id AND c.embedding IS NOT NULL AND public.ai_knowledge_document_is_approved(d.id,p_account_id)
 UNION ALL
 SELECT c.id,'[source product='||p.id::text||' chunk='||c.id::text||'] '||c.content,(c.embedding<=>p_query_embedding::vector(1536))::real,'product:'||p.id::text
 FROM public.ai_product_search_chunks c JOIN public.ai_products p ON p.id=c.product_id AND p.account_id=c.account_id
 WHERE c.account_id=p_account_id AND c.embedding IS NOT NULL AND public.ai_product_is_approved(p.id,p_account_id)
 ), diverse AS (SELECT *,row_number() OVER(PARTITION BY source_key ORDER BY distance,id) source_rank FROM matches) SELECT id,content,distance FROM diverse WHERE source_rank<=2 ORDER BY distance,id LIMIT LEAST(GREATEST(p_match_count,0),20);
$$;

CREATE FUNCTION public.import_ai_customer_guides(p_account_id uuid,p_entries jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE entry jsonb; added integer:=0; affected integer;
BEGIN
 IF NOT public.is_account_member(p_account_id,'admin') THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(p_entries)>100 THEN RAISE EXCEPTION 'Invalid guide import' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text,77));
 FOR entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.ai_products WHERE id=(entry->>'product_id')::uuid AND account_id=p_account_id AND kind='family' AND superseded_by IS NULL) THEN
   RAISE EXCEPTION 'Choose a current family in this account' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.ai_knowledge_documents(account_id,created_by,title,content,status,topic,product_id,document_type,guide_sections,source_notes)
  VALUES(p_account_id,auth.uid(),entry->>'title','','draft','product',(entry->>'product_id')::uuid,'customer_guide',entry->'guide_sections',coalesce(entry->>'source_notes',''))
  ON CONFLICT(account_id,product_id) WHERE document_type='customer_guide' DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT; added:=added+affected;
 END LOOP;
 RETURN added;
END $$;
REVOKE ALL ON FUNCTION public.prepare_ai_customer_guide() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_product_is_current(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_knowledge_document_is_approved(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_ai_customer_guides(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_ai_customer_guide(),public.ai_product_is_current(uuid,uuid),public.ai_knowledge_document_is_approved(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.import_ai_customer_guides(uuid,jsonb) TO authenticated;
COMMIT;
