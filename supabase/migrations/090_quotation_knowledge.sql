-- Source records are append-only. Reviews are account-scoped, versioned and audited.
CREATE TABLE public.quotation_knowledge_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 source_version text NOT NULL, label text NOT NULL, sources jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 UNIQUE(account_id,source_version)
);
CREATE TABLE public.quotation_knowledge_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL REFERENCES quotation_knowledge_batches(id) ON DELETE CASCADE,
 record_key text NOT NULL, kind text NOT NULL, source text NOT NULL, source_row integer NOT NULL,
 data jsonb NOT NULL, search_text text NOT NULL,
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
 review_version integer NOT NULL DEFAULT 0, review_notes text, reviewed_at timestamptz, reviewed_by uuid,
 configuration jsonb NOT NULL DEFAULT '{}', UNIQUE(batch_id,record_key)
);
CREATE INDEX quotation_knowledge_search ON quotation_knowledge_records(account_id,batch_id,kind,review_status);
CREATE TABLE public.quotation_knowledge_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES quotation_knowledge_records(id) ON DELETE CASCADE,
 version integer NOT NULL, status text NOT NULL, notes text NOT NULL, configuration jsonb NOT NULL,
 reviewed_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,version)
);
ALTER TABLE public.quotation_knowledge_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_knowledge_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_knowledge_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY quotation_knowledge_batches_read ON quotation_knowledge_batches FOR SELECT TO authenticated USING(is_account_member(account_id,'agent'));
CREATE POLICY quotation_knowledge_records_read ON quotation_knowledge_records FOR SELECT TO authenticated USING(is_account_member(account_id,'agent'));
CREATE POLICY quotation_knowledge_reviews_read ON quotation_knowledge_reviews FOR SELECT TO authenticated USING(is_account_member(account_id,'agent'));
GRANT SELECT ON quotation_knowledge_batches,quotation_knowledge_records,quotation_knowledge_reviews TO authenticated;
REVOKE ALL ON quotation_knowledge_batches,quotation_knowledge_records,quotation_knowledge_reviews FROM anon;
REVOKE INSERT,UPDATE,DELETE ON quotation_knowledge_batches,quotation_knowledge_records,quotation_knowledge_reviews FROM authenticated;

CREATE FUNCTION public.import_quotation_knowledge(p_account_id uuid,p_pack jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid;
BEGIN
 IF NOT is_account_member(p_account_id,'admin') THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF p_pack->>'format'<>'1' OR jsonb_typeof(p_pack->'records')<>'array' OR jsonb_array_length(p_pack->'records')>10000
 OR length(p_pack->>'version')<>64 THEN RAISE EXCEPTION 'Invalid source pack'; END IF;
 INSERT INTO quotation_knowledge_batches(account_id,source_version,label,sources,created_by)
 VALUES(p_account_id,p_pack->>'version',p_pack->>'label',p_pack->'sources',auth.uid())
 ON CONFLICT(account_id,source_version) DO NOTHING RETURNING id INTO b;
 IF b IS NULL THEN SELECT id INTO b FROM quotation_knowledge_batches WHERE account_id=p_account_id AND source_version=p_pack->>'version'; RETURN b; END IF;
 INSERT INTO quotation_knowledge_records(account_id,batch_id,record_key,kind,source,source_row,data,search_text)
 SELECT p_account_id,b,e->>'key',e->>'kind',e->>'source',(e->>'row')::integer,e->'data',lower((e->'data')::text)
 FROM jsonb_array_elements(p_pack->'records') e;
 RETURN b;
END; $$;
CREATE FUNCTION public.review_quotation_knowledge(p_id uuid,p_version integer,p_status text,p_notes text,p_configuration jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r quotation_knowledge_records;
BEGIN
 SELECT * INTO r FROM quotation_knowledge_records WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL OR NOT is_account_member(r.account_id,'admin') THEN RAISE EXCEPTION 'Source record not found'; END IF;
 IF p_version IS NULL OR r.review_version<>p_version THEN RAISE EXCEPTION 'Review changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 IF p_status NOT IN ('pending','approved','rejected') OR length(trim(p_notes))=0 OR length(p_notes)>10000 OR jsonb_typeof(p_configuration)<>'object' THEN RAISE EXCEPTION 'Invalid review'; END IF;
 IF p_configuration ? 'catalogItemId' AND NOT EXISTS(SELECT 1 FROM catalog_items WHERE id=(p_configuration->>'catalogItemId')::uuid AND account_id=r.account_id) THEN RAISE EXCEPTION 'Catalog item not found'; END IF;
 UPDATE quotation_knowledge_records SET review_status=p_status, review_version=r.review_version+1,
 review_notes=p_notes,configuration=p_configuration,reviewed_at=now(),reviewed_by=auth.uid() WHERE id=p_id;
 INSERT INTO quotation_knowledge_reviews(account_id,record_id,version,status,notes,configuration,reviewed_by)
 VALUES(r.account_id,p_id,r.review_version+1,p_status,p_notes,p_configuration,auth.uid());
END; $$;
REVOKE ALL ON FUNCTION import_quotation_knowledge(uuid,jsonb),review_quotation_knowledge(uuid,integer,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION import_quotation_knowledge(uuid,jsonb),review_quotation_knowledge(uuid,integer,text,text,jsonb) TO authenticated;

-- Exact spelling aliases link archive evidence without merging live CRM contacts.
CREATE FUNCTION public.quotation_archive_name(p_text text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT regexp_replace(lower(regexp_replace(coalesce(p_text,''),'^\s*[mM]/[sS]\s*','','g')),'[^a-z0-9ء-ي]','','g')
$$;
CREATE FUNCTION public.quotation_archive_history(p_client_id uuid) RETURNS SETOF quotation_knowledge_records
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT r.* FROM quotation_knowledge_records c JOIN quotation_knowledge_records r ON r.account_id=c.account_id AND r.batch_id=c.batch_id
 WHERE c.id=p_client_id AND c.kind='client' AND r.kind IN ('quotation','invoice','job')
 AND EXISTS(SELECT 1 FROM unnest(string_to_array(coalesce(c.data->>'spelling_variants_seen','') || '|' || coalesce(c.data->>'client_key',''),'|')) alias
 WHERE quotation_archive_name(alias)<>'' AND quotation_archive_name(alias)=quotation_archive_name(r.data->>'Client'))
 ORDER BY r.kind,r.source_row
$$;
REVOKE ALL ON FUNCTION quotation_archive_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION quotation_archive_history(uuid) TO authenticated;

-- Sales follow-up notes are independent of issued commercial/PDF content.
CREATE TABLE public.quotation_sales_notes (
 quotation_id uuid PRIMARY KEY REFERENCES quotations(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 reason text NOT NULL DEFAULT '', follow_up_date date, version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quotation_sales_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY quotation_sales_notes_read ON quotation_sales_notes FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM quotations q WHERE q.id=quotation_id AND q.account_id=quotation_sales_notes.account_id));
GRANT SELECT ON quotation_sales_notes TO authenticated;
REVOKE ALL ON quotation_sales_notes FROM anon;
REVOKE INSERT,UPDATE,DELETE ON quotation_sales_notes FROM authenticated;
CREATE FUNCTION public.save_quotation_sales_notes(p_quotation_id uuid,p_version integer,p_reason text,p_follow_up_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q quotations; n quotation_sales_notes;
BEGIN
 SELECT * INTO q FROM quotations WHERE id=p_quotation_id FOR UPDATE;
 IF q.id IS NULL OR NOT coalesce((is_account_member(q.account_id,'admin') OR (is_account_member(q.account_id,'agent') AND q.assigned_to=(SELECT id FROM profiles WHERE user_id=auth.uid()))),false) THEN RAISE EXCEPTION 'Quotation not found'; END IF;
 IF p_reason IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Invalid sales notes'; END IF;
 SELECT * INTO n FROM quotation_sales_notes WHERE quotation_id=q.id;
 IF p_version IS NULL OR coalesce(n.version,0)<>p_version THEN RAISE EXCEPTION 'Notes changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 INSERT INTO quotation_sales_notes(quotation_id,account_id,reason,follow_up_date,version,updated_by)
 VALUES(q.id,q.account_id,trim(p_reason),p_follow_up_date,coalesce(n.version,0)+1,auth.uid())
 ON CONFLICT(quotation_id) DO UPDATE SET reason=EXCLUDED.reason,follow_up_date=EXCLUDED.follow_up_date,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now();
END; $$;
REVOKE ALL ON FUNCTION save_quotation_sales_notes(uuid,integer,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION save_quotation_sales_notes(uuid,integer,text,date) TO authenticated;
