-- One capacity slot for the entire account, including requests owned by other agents.
-- Existing requested dates remain unconfirmed; do not invent their durations.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SET search_path = public, extensions;

-- A request's original creator is historical evidence. Membership removal must
-- not prevent another authorized member from updating or reassigning the work.
CREATE OR REPLACE FUNCTION public.check_group_handoff_tenant() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM deals WHERE id=NEW.deal_id AND account_id=NEW.account_id) THEN RAISE EXCEPTION 'Invalid deal tenant'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=NEW.created_by AND account_id=NEW.account_id AND account_role IN ('agent','admin','owner')) THEN RAISE EXCEPTION 'Invalid creator'; END IF;
  INSERT INTO group_job_references(deal_id) VALUES(NEW.deal_id) ON CONFLICT(deal_id) DO UPDATE SET deal_id=EXCLUDED.deal_id RETURNING reference INTO NEW.reference;
 ELSE
  IF ROW(NEW.account_id,NEW.deal_id,NEW.created_by,NEW.reference) IS DISTINCT FROM ROW(OLD.account_id,OLD.deal_id,OLD.created_by,OLD.reference) THEN RAISE EXCEPTION 'Request ownership is immutable' USING ERRCODE='22023'; END IF;
 END IF;
 IF NEW.quotation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quotations WHERE id=NEW.quotation_id AND account_id=NEW.account_id AND deal_id=NEW.deal_id) THEN RAISE EXCEPTION 'Invalid quotation tenant'; END IF;
 RETURN NEW;
END; $$;

ALTER TABLE public.group_handoffs ADD COLUMN responsible_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE TABLE public.job_appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
 handoff_id uuid NOT NULL UNIQUE REFERENCES public.group_handoffs(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('visit','installation')),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 responsible_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 responsible_name text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','completed','cancelled')),
 revision integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at >= starts_at + interval '15 minutes' AND ends_at <= starts_at + interval '24 hours'),
 CONSTRAINT job_appointments_company_capacity EXCLUDE USING gist
   (account_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status='reserved')
);
CREATE INDEX job_appointments_calendar ON public.job_appointments(account_id,starts_at);
ALTER TABLE public.job_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_appointments_select ON public.job_appointments FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.deals d WHERE d.id=deal_id AND d.account_id=job_appointments.account_id)
);
REVOKE ALL ON public.job_appointments FROM anon,authenticated;
GRANT SELECT ON public.job_appointments TO authenticated;
GRANT ALL ON public.job_appointments TO service_role;

CREATE FUNCTION public.job_actor_can_access(p_account uuid,p_deal uuid,p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM deals d JOIN profiles p ON p.account_id=d.account_id
 WHERE d.id=p_deal AND d.account_id=p_account AND p.user_id=p_actor
 AND (p.account_role IN ('owner','admin') OR (p.account_role='agent' AND d.assigned_to=p.id)))
$$;
REVOKE ALL ON FUNCTION public.job_actor_can_access(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.job_actor_can_access(uuid,uuid,uuid) TO service_role;

-- Server-only, atomic creation: failed reservation rolls back the whole request.
CREATE FUNCTION public.create_scheduled_group_handoff(
 p_account uuid,p_deal uuid,p_actor uuid,p_kind text,p_location text,p_details text,
 p_responsible uuid,p_start timestamptz,p_end timestamptz,p_quotation uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE work_id uuid; appointment_id uuid; person text; q record; snapshot jsonb;
BEGIN
 IF NOT job_actor_can_access(p_account,p_deal,p_actor) THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN ('measurement','workshop') OR length(trim(p_location)) NOT BETWEEN 1 AND 1000 OR length(trim(p_details)) NOT BETWEEN 10 AND 10000
 OR p_start IS NULL OR p_end IS NULL OR p_start<=now() OR NOT isfinite(p_start) OR NOT isfinite(p_end) THEN RAISE EXCEPTION 'Invalid request or appointment' USING ERRCODE='22023'; END IF;
 SELECT coalesce(nullif(trim(full_name),''),'Team member') INTO person FROM profiles
 WHERE id=p_responsible AND account_id=p_account AND account_role IN ('agent','admin','owner') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose a current CRM member' USING ERRCODE='22023'; END IF;
 IF p_kind='workshop' THEN
  SELECT qt.id,qt.reference,qt.revision INTO q FROM quotations qt WHERE qt.id=p_quotation AND qt.account_id=p_account AND qt.deal_id=p_deal AND qt.status='won'
  AND EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=p_actor AND p.account_id=p_account AND (p.account_role IN ('owner','admin') OR qt.assigned_to=p.id)) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an accepted quotation belonging to this job' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object('reference',q.reference,'revision',q.revision,'items',coalesce(jsonb_agg(jsonb_build_object(
   'description',description,'description_ar',description_ar,'size_w',size_w,'size_h',size_h,'qty',qty) ORDER BY position),'[]'::jsonb))
  INTO snapshot FROM quotation_items WHERE quotation_id=q.id AND item_type='line';
  IF jsonb_array_length(snapshot->'items')=0 THEN RAISE EXCEPTION 'The accepted quotation has no line items' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO group_handoffs(account_id,deal_id,created_by,kind,location,details,responsible,responsible_profile_id,due_at,quotation_id,quotation_snapshot)
 VALUES(p_account,p_deal,p_actor,p_kind,trim(p_location),trim(p_details),person,p_responsible,p_start,CASE WHEN p_kind='workshop' THEN p_quotation END,snapshot)
 RETURNING id INTO work_id;
 INSERT INTO job_appointments(account_id,deal_id,handoff_id,kind,starts_at,ends_at,responsible_profile_id,responsible_name,created_by)
 VALUES(p_account,p_deal,work_id,CASE WHEN p_kind='measurement' THEN 'visit' ELSE 'installation' END,p_start,p_end,p_responsible,person,p_actor)
 RETURNING id INTO appointment_id;
 INSERT INTO group_handoff_events(handoff_id,action,status,note,created_by)
 VALUES(work_id,'update','draft','Calendar reservation: '||to_char(p_start AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI')||' – '||to_char(p_end AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI')||' (Qatar). Responsible: '||person,p_actor);
 RETURN jsonb_build_object('id',work_id,'appointmentId',appointment_id);
END; $$;
REVOKE ALL ON FUNCTION public.create_scheduled_group_handoff(uuid,uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_scheduled_group_handoff(uuid,uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,uuid) TO service_role;

-- Also schedules historical requests. Lock the request before its appointment,
-- matching terminal-state processing; revision prevents stale calendar edits.
CREATE FUNCTION public.save_job_appointment(
 p_account uuid,p_deal uuid,p_handoff uuid,p_actor uuid,p_responsible uuid,
 p_start timestamptz,p_end timestamptz,p_revision integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE work group_handoffs; current_booking job_appointments; person text; result uuid;
BEGIN
 IF NOT job_actor_can_access(p_account,p_deal,p_actor) THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO work FROM group_handoffs WHERE id=p_handoff AND account_id=p_account AND deal_id=p_deal FOR UPDATE;
 IF NOT FOUND OR work.status IN ('report_received','installed','cancelled') THEN RAISE EXCEPTION 'This request is closed' USING ERRCODE='22023'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start<=now() OR NOT isfinite(p_start) OR NOT isfinite(p_end) THEN RAISE EXCEPTION 'Choose a future appointment' USING ERRCODE='22023'; END IF;
 SELECT coalesce(nullif(trim(full_name),''),'Team member') INTO person FROM profiles
 WHERE id=p_responsible AND account_id=p_account AND account_role IN ('agent','admin','owner') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose a current CRM member' USING ERRCODE='22023'; END IF;
 SELECT * INTO current_booking FROM job_appointments WHERE handoff_id=p_handoff FOR UPDATE;
 IF FOUND THEN
  IF p_revision IS DISTINCT FROM current_booking.revision OR current_booking.status<>'reserved' THEN RETURN NULL; END IF;
  UPDATE job_appointments SET starts_at=p_start,ends_at=p_end,responsible_profile_id=p_responsible,responsible_name=person,revision=revision+1,updated_at=now()
  WHERE id=current_booking.id RETURNING id INTO result;
 ELSE
  IF p_revision IS NOT NULL THEN RETURN NULL; END IF;
  INSERT INTO job_appointments(account_id,deal_id,handoff_id,kind,starts_at,ends_at,responsible_profile_id,responsible_name,created_by)
  VALUES(p_account,p_deal,p_handoff,CASE WHEN work.kind='measurement' THEN 'visit' ELSE 'installation' END,p_start,p_end,p_responsible,person,p_actor)
  RETURNING id INTO result;
 END IF;
 UPDATE group_handoffs SET due_at=p_start,responsible=person,responsible_profile_id=p_responsible,revision=revision+1,updated_at=now() WHERE id=p_handoff;
 INSERT INTO group_handoff_events(handoff_id,action,status,note,created_by)
 VALUES(p_handoff,'update',work.status,CASE WHEN current_booking.id IS NOT NULL THEN 'Rescheduled from '||to_char(current_booking.starts_at AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI')||' – '||to_char(current_booking.ends_at AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI')||'. ' ELSE '' END||'Calendar reservation: '||to_char(p_start AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI')||' – '||to_char(p_end AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI')||' (Qatar). Responsible: '||person,p_actor);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.save_job_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_job_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer) TO service_role;

CREATE FUNCTION public.finish_job_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('report_received','installed','cancelled') THEN
  UPDATE job_appointments SET status=CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'completed' END,
  revision=revision+1,updated_at=now() WHERE handoff_id=NEW.id AND status='reserved';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.finish_job_appointment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finish_job_appointment AFTER UPDATE OF status ON public.group_handoffs FOR EACH ROW EXECUTE FUNCTION public.finish_job_appointment();
CREATE FUNCTION public.job_calendar_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.job_appointments'::regclass AND conname='job_appointments_company_capacity' AND contype='x')
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.job_appointments'::regclass)
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.group_handoffs'::regclass AND tgname='finish_job_appointment' AND tgenabled='O')
 AND has_function_privilege('service_role','public.create_scheduled_group_handoff(uuid,uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.save_job_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.create_scheduled_group_handoff(uuid,uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.save_job_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer)','EXECUTE')
$$;
REVOKE ALL ON FUNCTION public.job_calendar_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.job_calendar_ready() TO service_role;
NOTIFY pgrst,'reload schema';
