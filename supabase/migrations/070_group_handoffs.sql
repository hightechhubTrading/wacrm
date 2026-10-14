-- Sales-owned records of work coordinated in external WhatsApp groups.
CREATE TABLE public.group_job_references (
 deal_id uuid PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
 reference bigint GENERATED ALWAYS AS IDENTITY UNIQUE
);
ALTER TABLE group_job_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON group_job_references FROM anon,authenticated;
GRANT ALL ON group_job_references TO service_role;
GRANT USAGE,SELECT ON SEQUENCE group_job_references_reference_seq TO service_role;
CREATE TABLE public.group_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
 reference bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('measurement','workshop')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','waiting','in_progress','report_received','ready','installed','blocked','cancelled')),
 location text NOT NULL,
 details text NOT NULL,
 responsible text,
 due_at timestamptz,
 quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL,
 quotation_snapshot jsonb,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind <> 'workshop' OR quotation_snapshot IS NOT NULL),
 CHECK((kind='measurement' AND status IN ('draft','waiting','in_progress','report_received','blocked','cancelled')) OR (kind='workshop' AND status<>'report_received'))
);
CREATE UNIQUE INDEX group_handoffs_active ON group_handoffs(deal_id,kind) WHERE status NOT IN ('report_received','installed','cancelled');
CREATE INDEX group_handoffs_queue ON group_handoffs(account_id,status,due_at);
CREATE TABLE public.group_handoff_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 handoff_id uuid NOT NULL REFERENCES group_handoffs(id) ON DELETE CASCADE,
 action text NOT NULL,
 status text NOT NULL,
 note text NOT NULL DEFAULT '',
 attachments jsonb NOT NULL DEFAULT '[]',
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE group_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_handoff_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_handoffs_select ON group_handoffs FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM deals d WHERE d.id=deal_id AND d.account_id=group_handoffs.account_id)
);
CREATE POLICY group_handoff_events_select ON group_handoff_events FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM group_handoffs h WHERE h.id=handoff_id)
);
REVOKE ALL ON group_handoffs,group_handoff_events FROM anon,authenticated;
GRANT SELECT ON group_handoffs,group_handoff_events TO authenticated;
GRANT ALL ON group_handoffs,group_handoff_events TO service_role;

CREATE FUNCTION public.check_group_handoff_tenant() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM deals WHERE id=NEW.deal_id AND account_id=NEW.account_id) THEN
 RAISE EXCEPTION 'Invalid deal tenant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=NEW.created_by AND account_id=NEW.account_id AND account_role IN ('agent','admin','owner')) THEN
 RAISE EXCEPTION 'Invalid creator'; END IF;
 IF NEW.quotation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quotations WHERE id=NEW.quotation_id AND account_id=NEW.account_id AND deal_id=NEW.deal_id) THEN
 RAISE EXCEPTION 'Invalid quotation tenant'; END IF;
 IF TG_OP='INSERT' THEN
 INSERT INTO group_job_references(deal_id) VALUES(NEW.deal_id) ON CONFLICT(deal_id) DO UPDATE SET deal_id=EXCLUDED.deal_id RETURNING reference INTO NEW.reference;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_handoffs_tenant BEFORE INSERT OR UPDATE ON group_handoffs FOR EACH ROW EXECUTE FUNCTION check_group_handoff_tenant();
-- Atomic state change + append-only history; revision rejects stale browser actions.
CREATE FUNCTION public.record_group_handoff_event(p_account uuid,p_deal uuid,p_id uuid,p_revision integer,p_actor uuid,p_action text,p_status text,p_note text,p_attachments jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; previous text; work_kind text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=p_actor AND account_id=p_account AND account_role IN ('agent','admin','owner')) THEN RAISE EXCEPTION 'Invalid actor'; END IF;
 SELECT status,kind INTO previous,work_kind FROM group_handoffs WHERE id=p_id AND account_id=p_account AND deal_id=p_deal AND revision=p_revision FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF previous IN ('report_received','installed','cancelled') THEN RETURN NULL; END IF;
 IF NOT (
 (p_action='posted' AND previous='draft' AND p_status='waiting') OR
 (p_action='update' AND previous<>'draft' AND p_status=previous) OR
 (p_action='started' AND previous IN ('waiting','blocked') AND p_status='in_progress') OR
 (p_action='report' AND work_kind='measurement' AND previous<>'draft' AND p_status='report_received') OR
 (p_action='ready' AND work_kind='workshop' AND previous IN ('waiting','in_progress','blocked') AND p_status='ready') OR
 (p_action='installed' AND work_kind='workshop' AND previous='ready' AND p_status='installed') OR
 (p_action='blocked' AND previous IN ('waiting','in_progress','ready') AND p_status='blocked') OR
 (p_action='cancelled' AND p_status='cancelled')
 ) THEN RAISE EXCEPTION 'Invalid transition'; END IF;
 IF p_action IN ('report','ready','installed','blocked','cancelled') AND length(trim(p_note))<10 AND jsonb_array_length(p_attachments)=0 THEN RAISE EXCEPTION 'Evidence required'; END IF;
 UPDATE group_handoffs SET status=p_status,revision=revision+1,updated_at=now() WHERE id=p_id;
 INSERT INTO group_handoff_events(handoff_id,action,status,note,attachments,created_by) VALUES(p_id,p_action,p_status,p_note,p_attachments,p_actor) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION record_group_handoff_event(uuid,uuid,uuid,integer,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION record_group_handoff_event(uuid,uuid,uuid,integer,uuid,text,text,text,jsonb) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('job-reports','job-reports',false,10485760) ON CONFLICT(id) DO NOTHING;
