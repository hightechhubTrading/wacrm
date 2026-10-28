-- Separate collection work from approved facts. Search is a disposable projection.
BEGIN;
SET LOCAL search_path = public, extensions;
-- Keep duplicate research records as recoverable history, not a second catalog.
ALTER TABLE public.ai_products ADD COLUMN superseded_by uuid,
 ADD CONSTRAINT product_superseded_account FOREIGN KEY(account_id,superseded_by) REFERENCES public.ai_products(account_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT product_not_self_superseded CHECK(superseded_by IS DISTINCT FROM id);
CREATE OR REPLACE FUNCTION public.ai_product_is_approved(p_id uuid,p_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH RECURSIVE chain AS (
  SELECT id,parent_id,status,superseded_by FROM public.ai_products WHERE id=p_id AND account_id=p_account
  UNION
  SELECT p.id,p.parent_id,p.status,p.superseded_by FROM public.ai_products p JOIN chain c ON p.id=c.parent_id WHERE p.account_id=p_account
 ) SELECT count(*)>0 AND bool_and(status='approved' AND superseded_by IS NULL) AND bool_or(parent_id IS NULL) FROM chain;
$$;
CREATE TABLE public.ai_catalog_questions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 product_id uuid,
 question text NOT NULL CHECK (length(trim(question)) BETWEEN 1 AND 2000),
 answer text NOT NULL DEFAULT '' CHECK (length(answer)<=12000),
 evidence text NOT NULL DEFAULT '' CHECK (length(evidence)<=2000),
 confirmed_by text NOT NULL DEFAULT '' CHECK (length(confirmed_by)<=200),
 confirmed_on date,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,product_id) REFERENCES public.ai_products(account_id,id) ON DELETE RESTRICT,
 UNIQUE(account_id,question)
);
ALTER TABLE public.ai_catalog_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_questions_read ON public.ai_catalog_questions FOR SELECT USING(public.is_account_member(account_id));
CREATE POLICY catalog_questions_write ON public.ai_catalog_questions FOR ALL USING(public.is_account_member(account_id,'admin')) WITH CHECK(public.is_account_member(account_id,'admin'));
CREATE TRIGGER catalog_questions_updated BEFORE UPDATE ON public.ai_catalog_questions FOR EACH ROW EXECUTE FUNCTION public.update_ai_knowledge_documents_updated_at();
CREATE INDEX catalog_questions_product ON public.ai_catalog_questions(account_id,product_id);
-- Preserve the source checklist as collection-only history and link its questions
-- to exact existing products where the original section identifies one.
ALTER TABLE public.ai_knowledge_documents ADD COLUMN collection_only boolean NOT NULL DEFAULT false;
WITH lines AS (
 SELECT d.id,d.account_id,d.created_by,t.line,t.n,
  max(CASE WHEN t.line LIKE '## %' THEN t.n END) OVER(PARTITION BY d.id ORDER BY t.n) heading
 FROM public.ai_knowledge_documents d
 CROSS JOIN LATERAL regexp_split_to_table(d.content,E'\\n') WITH ORDINALITY t(line,n)
 WHERE d.status='draft' AND d.title='أسئلة الشركة المفتوحة — أبواب الكراجات والمحلات وشتر النوافذ'
), questions AS (
 SELECT l.*,h.line section,regexp_replace(l.line,'^[0-9]+\. \[ \] ','') question
 FROM lines l LEFT JOIN lines h ON h.id=l.id AND h.n=l.heading
 WHERE l.line ~ '^[0-9]+\. \[ \] '
)
INSERT INTO public.ai_catalog_questions(account_id,product_id,question,created_by)
SELECT q.account_id,(SELECT p.id FROM public.ai_products p WHERE p.account_id=q.account_id AND p.kind='product' AND p.status='approved' AND p.superseded_by IS NULL AND
 ((q.section LIKE '%الكراجات%' AND p.name IN ('ابواب الكراجات لمداخل الفيلا','أبواب الكراجات')) OR
  (q.section LIKE '%المحلات%' AND p.name IN ('ابواب المحلات التجاريه أنواعها','أبواب المحلات')) OR
  (q.section LIKE '%النوافذ%' AND p.id='b281fe23-26af-4509-a01c-cbb8546c6e22')) ORDER BY p.created_at LIMIT 1),q.question,q.created_by
FROM questions q ON CONFLICT(account_id,question) DO NOTHING;
UPDATE public.ai_knowledge_documents SET collection_only=true
 WHERE status='draft' AND title='أسئلة الشركة المفتوحة — أبواب الكراجات والمحلات وشتر النوافذ';

CREATE TABLE public.ai_product_search_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 chunk_index integer NOT NULL,
 content text NOT NULL,
 embedding vector(1536),
 fts tsvector GENERATED ALWAYS AS(to_tsvector('simple',content)) STORED,
 FOREIGN KEY(account_id,product_id) REFERENCES public.ai_products(account_id,id) ON DELETE CASCADE,
 UNIQUE(product_id,chunk_index)
);
CREATE INDEX product_search_account ON public.ai_product_search_chunks(account_id);
CREATE INDEX product_search_fts ON public.ai_product_search_chunks USING gin(fts);
CREATE INDEX product_search_vectors ON public.ai_product_search_chunks USING hnsw(embedding vector_cosine_ops);
ALTER TABLE public.ai_product_search_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_search_read ON public.ai_product_search_chunks FOR SELECT USING(public.is_account_member(account_id));
CREATE POLICY product_search_write ON public.ai_product_search_chunks FOR ALL USING(public.is_account_member(account_id,'admin')) WITH CHECK(public.is_account_member(account_id,'admin'));

CREATE FUNCTION public.refresh_ai_product_search() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,extensions AS $$
DECLARE body text; prefix text; i integer;
BEGIN
 -- Internal source notes, unanswered questions and attachment guesses never enter search.
 DELETE FROM public.ai_product_search_chunks WHERE product_id=NEW.id AND account_id=NEW.account_id;
 IF NEW.status<>'approved' OR NEW.superseded_by IS NOT NULL OR NEW.kind='family' THEN RETURN NEW; END IF;
 prefix := NEW.name||E'\nAliases: '||array_to_string(NEW.aliases,', ')||E'\n';
 body := concat_ws(E'\n',NEW.description,
   CASE WHEN NEW.price_min IS NOT NULL AND NEW.price_max IS NOT NULL AND NEW.price_unit IS NOT NULL
    THEN 'Recorded estimate: '||NEW.price_min||'–'||NEW.price_max||' ['||NEW.price_unit||']. '||coalesce(NEW.price_notes,'')
    ELSE 'No approved estimate on this exact entry.' END,
   'Specifications: '||NEW.specifications,'Limitations: '||NEW.limitations);
 FOR i IN 0..greatest(0,(length(body)-1)/2400) LOOP
  INSERT INTO public.ai_product_search_chunks(account_id,product_id,chunk_index,content)
  VALUES(NEW.account_id,NEW.id,i,prefix||substring(body FROM i*2400+1 FOR 2400));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER product_search_refresh AFTER INSERT OR UPDATE OF name,description,aliases,specifications,limitations,price_min,price_max,price_unit,price_notes,status,kind,superseded_by
 ON public.ai_products FOR EACH ROW EXECUTE FUNCTION public.refresh_ai_product_search();
-- Build lexical projections once. No external embedding requests in a migration.
UPDATE public.ai_products SET name=name WHERE status='approved' AND kind<>'family';

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(p_account_id uuid,p_query text,p_match_count integer)
RETURNS TABLE(id uuid,content text,rank real) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH query AS (SELECT websearch_to_tsquery('simple',regexp_replace(p_query,'\s+',' OR ','g')) q), matches AS (
 SELECT c.id,'[source document='||d.id::text||' chunk='||c.id::text||'] '||d.title||E'\n'||
 CASE WHEN d.source_url IS NULL THEN '' ELSE 'Source: '||d.source_url||E'\n' END||c.content content,ts_rank(c.fts,q.q) rank
 FROM public.ai_knowledge_chunks c JOIN public.ai_knowledge_documents d ON d.id=c.document_id AND d.account_id=c.account_id CROSS JOIN query q
 WHERE c.account_id=p_account_id AND d.status='approved' AND NOT d.collection_only AND (d.product_id IS NULL OR public.ai_product_is_approved(d.product_id,p_account_id)) AND c.fts@@q.q
 UNION ALL
 SELECT c.id,'[source product='||p.id::text||' chunk='||c.id::text||'] '||c.content,ts_rank(c.fts,q.q)
 FROM public.ai_product_search_chunks c JOIN public.ai_products p ON p.id=c.product_id AND p.account_id=c.account_id CROSS JOIN query q
 WHERE c.account_id=p_account_id AND public.ai_product_is_approved(p.id,p_account_id) AND c.fts@@q.q
 ) SELECT * FROM matches ORDER BY rank DESC LIMIT LEAST(GREATEST(p_match_count,0),20);
$$;
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid,p_query_embedding text,p_match_count integer)
RETURNS TABLE(id uuid,content text,distance real) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions AS $$
 WITH matches AS (
 SELECT c.id,'[source document='||d.id::text||' chunk='||c.id::text||'] '||d.title||E'\n'||
 CASE WHEN d.source_url IS NULL THEN '' ELSE 'Source: '||d.source_url||E'\n' END||c.content content,(c.embedding<=>p_query_embedding::vector(1536))::real distance
 FROM public.ai_knowledge_chunks c JOIN public.ai_knowledge_documents d ON d.id=c.document_id AND d.account_id=c.account_id
 WHERE c.account_id=p_account_id AND d.status='approved' AND NOT d.collection_only AND c.embedding IS NOT NULL AND (d.product_id IS NULL OR public.ai_product_is_approved(d.product_id,p_account_id))
 UNION ALL
 SELECT c.id,'[source product='||p.id::text||' chunk='||c.id::text||'] '||c.content,(c.embedding<=>p_query_embedding::vector(1536))::real
 FROM public.ai_product_search_chunks c JOIN public.ai_products p ON p.id=c.product_id AND p.account_id=c.account_id
 WHERE c.account_id=p_account_id AND c.embedding IS NOT NULL AND public.ai_product_is_approved(p.id,p_account_id)
 ) SELECT * FROM matches ORDER BY distance LIMIT LEAST(GREATEST(p_match_count,0),20);
$$;
REVOKE ALL ON FUNCTION public.refresh_ai_product_search() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ai_product_search() TO authenticated,service_role;
-- Existing retrieval grants are retained by CREATE OR REPLACE.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_catalog_questions,public.ai_product_search_chunks TO authenticated,service_role;
-- Invalidate old document evidence in the same transaction as an edit.
CREATE FUNCTION public.invalidate_ai_document_search() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF OLD.content IS DISTINCT FROM NEW.content OR NEW.status='draft' OR NEW.collection_only THEN
  DELETE FROM public.ai_knowledge_chunks WHERE document_id=NEW.id AND account_id=NEW.account_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_search_invalidate AFTER UPDATE OF content,status,collection_only ON public.ai_knowledge_documents
 FOR EACH ROW EXECUTE FUNCTION public.invalidate_ai_document_search();
-- Commit a complete index only if its exact source is still current and approved.
CREATE FUNCTION public.replace_ai_knowledge_chunks(p_account_id uuid,p_document_id uuid,p_content text,p_chunks jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,extensions AS $$
DECLARE doc public.ai_knowledge_documents%ROWTYPE;
BEGIN
 SELECT * INTO doc FROM public.ai_knowledge_documents WHERE id=p_document_id AND account_id=p_account_id FOR UPDATE;
 IF NOT FOUND OR doc.status<>'approved' OR doc.collection_only OR doc.content IS DISTINCT FROM p_content THEN RETURN false; END IF;
 IF jsonb_typeof(p_chunks)<>'array' OR jsonb_array_length(p_chunks)>1000 THEN RAISE EXCEPTION 'Invalid chunks'; END IF;
 DELETE FROM public.ai_knowledge_chunks WHERE document_id=p_document_id AND account_id=p_account_id;
 INSERT INTO public.ai_knowledge_chunks(document_id,account_id,chunk_index,content,embedding)
 SELECT p_document_id,p_account_id,(ordinality-1)::integer,c->>'content',(c->>'embedding')::vector(1536)
 FROM jsonb_array_elements(p_chunks) WITH ORDINALITY AS entries(c,ordinality);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.invalidate_ai_document_search() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_ai_knowledge_chunks(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invalidate_ai_document_search() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.replace_ai_knowledge_chunks(uuid,uuid,text,jsonb) TO authenticated,service_role;
COMMIT;
