-- Complete server/web notification operations. Android activation remains deferred.
BEGIN;
ALTER TABLE notification_events ADD COLUMN source_key text, ADD COLUMN target_kind text,
 ADD COLUMN target_id uuid, ADD COLUMN source_reference text, ADD COLUMN copy_key text,
 ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high')),
 ADD COLUMN category text NOT NULL DEFAULT 'attention', ADD COLUMN acknowledged_at timestamptz,
 ADD COLUMN escalated_at timestamptz, ADD COLUMN valid_until timestamptz,
 ADD COLUMN parent_event_id uuid REFERENCES notification_events(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN source_key text, ADD COLUMN target_kind text, ADD COLUMN target_id uuid,
 ADD COLUMN source_reference text, ADD COLUMN copy_key text, ADD COLUMN priority text NOT NULL DEFAULT 'normal',
 ADD COLUMN category text NOT NULL DEFAULT 'attention', ADD COLUMN acknowledged_at timestamptz;
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notification_events DROP CONSTRAINT notification_events_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK(type IN
 ('conversation_assigned','ai_key_invalid','urgent_lead','ai_handoff','followup_due','reply_review_required','media_review_required','quotation_followup_due','appointment_due','appointment_changed','escalation'));
ALTER TABLE notification_events ADD CONSTRAINT notification_events_type_check CHECK(type IN
 ('conversation_assigned','ai_key_invalid','urgent_lead','ai_handoff','followup_due','reply_review_required','media_review_required','quotation_followup_due','appointment_due','appointment_changed','escalation'));
ALTER TABLE notification_preferences ALTER COLUMN push_categories SET DEFAULT ARRAY['assignments','attention','followups','system','jobs'];
ALTER TABLE notification_preferences ADD COLUMN foreground_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN sound_enabled boolean NOT NULL DEFAULT false, ADD COLUMN supervise_messages boolean NOT NULL DEFAULT false;
ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_push_categories_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_push_categories_check
 CHECK(push_categories <@ ARRAY['assignments','attention','followups','system','jobs']::text[]);
GRANT UPDATE(foreground_enabled,sound_enabled,supervise_messages) ON notification_preferences TO authenticated;
GRANT UPDATE(acknowledged_at) ON notifications TO authenticated;
CREATE TABLE notification_account_policy(account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 escalation_enabled boolean NOT NULL DEFAULT false, escalation_minutes integer NOT NULL DEFAULT 15 CHECK(escalation_minutes BETWEEN 5 AND 1440),
 timezone text NOT NULL DEFAULT 'Asia/Qatar',activated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE notification_account_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_account_policy_admin ON notification_account_policy FOR ALL TO authenticated
 USING(is_account_member(account_id,'admin')) WITH CHECK(is_account_member(account_id,'admin'));
GRANT SELECT,INSERT,UPDATE ON notification_account_policy TO authenticated;
GRANT ALL ON notification_account_policy TO service_role;
CREATE TABLE notification_worker_health(id boolean PRIMARY KEY DEFAULT true CHECK(id),last_success_at timestamptz,processed integer NOT NULL DEFAULT 0);
ALTER TABLE notification_worker_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_worker_health FROM PUBLIC,anon,authenticated;
GRANT ALL ON notification_worker_health TO service_role;
CREATE OR REPLACE FUNCTION notification_category(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_type='conversation_assigned' THEN 'assignments' WHEN p_type='ai_key_invalid' THEN 'system'
 WHEN p_type IN ('followup_due','quotation_followup_due') THEN 'followups' WHEN p_type IN ('appointment_due','appointment_changed') THEN 'jobs' ELSE 'attention' END;
$$;
CREATE OR REPLACE FUNCTION public.stage_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE episode uuid; due timestamptz; k text;
BEGIN
 IF NEW.event_id IS NOT NULL THEN RETURN NEW; END IF;
 k:=coalesce(NEW.source_key,gen_random_uuid()::text);
 IF NEW.type='urgent_lead' THEN
  SELECT notification_urgent_revision INTO episode FROM conversations WHERE id=NEW.conversation_id AND account_id=NEW.account_id AND ai_priority='urgent';
  IF episode IS NOT NULL THEN k:='urgent:'||episode; END IF;
 ELSIF NEW.type='ai_key_invalid' THEN
  SELECT notification_error_revision INTO episode FROM ai_configs WHERE account_id=NEW.account_id AND last_key_error IS NOT NULL;
  IF episode IS NOT NULL THEN k:='key:'||episode; END IF;
 END IF;
 IF NEW.type IN ('ai_handoff','conversation_assigned') AND NEW.conversation_id IS NOT NULL THEN
   SELECT notification_handoff_revision INTO episode FROM conversations
    WHERE id=NEW.conversation_id AND account_id=NEW.account_id AND ai_autoreply_disabled;
   IF episode IS NOT NULL AND NEW.type='ai_handoff' THEN k:='handoff:'||episode; END IF;
 END IF;
 IF NEW.type='followup_due' AND NEW.followup_id IS NOT NULL THEN
   SELECT due_at INTO due FROM ai_followups WHERE id=NEW.followup_id AND account_id=NEW.account_id AND conversation_id=NEW.conversation_id;
   IF NOT FOUND THEN RETURN NULL; END IF;
   k:='followup:'||NEW.followup_id||':'||to_char(due AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD');
 END IF;
 INSERT INTO notification_events(account_id,user_id,event_key,type,conversation_id,contact_id,actor_user_id,followup_id,title,body,source_key,target_kind,target_id,source_reference)
 VALUES(NEW.account_id,NEW.user_id,k,NEW.type,NEW.conversation_id,NEW.contact_id,NEW.actor_user_id,NEW.followup_id,NEW.title,NEW.body,NEW.source_key,NEW.target_kind,NEW.target_id,NEW.source_reference)
 ON CONFLICT(account_id,user_id,event_key) DO NOTHING;
 RETURN NULL;
END $$;

UPDATE notification_events SET copy_key=type,category=notification_category(type),priority=CASE WHEN type IN ('urgent_lead','ai_handoff','ai_key_invalid','reply_review_required','media_review_required') THEN 'high' ELSE 'normal' END;
UPDATE notifications SET category=notification_category(type),priority=CASE WHEN type IN ('urgent_lead','ai_handoff','ai_key_invalid','reply_review_required','media_review_required') THEN 'high' ELSE 'normal' END;
CREATE FUNCTION notification_metadata() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 NEW.copy_key:=NEW.type; NEW.category:=notification_category(NEW.type);
 NEW.priority:=CASE WHEN NEW.type IN ('urgent_lead','ai_handoff','ai_key_invalid','reply_review_required','media_review_required','escalation') THEN 'high' ELSE 'normal' END;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_metadata BEFORE INSERT ON notification_events FOR EACH ROW EXECUTE FUNCTION notification_metadata();
CREATE FUNCTION hydrate_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e notification_events; p profiles;
BEGIN
 IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO e FROM notification_events WHERE id=NEW.event_id;
 SELECT * INTO p FROM profiles WHERE user_id=NEW.user_id AND account_id=NEW.account_id;
 IF e.valid_until<=now() OR e.acknowledged_at IS NOT NULL THEN RETURN NULL; END IF;
 IF e.conversation_id IS NOT NULL AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=e.conversation_id AND c.status='closed') THEN RETURN NULL; END IF;
 IF e.target_kind='quotation' AND NOT EXISTS(SELECT 1 FROM quotations q WHERE q.id=e.target_id AND q.account_id=e.account_id AND q.archived_at IS NULL
   AND q.status IN ('draft','sent') AND (p.account_role IN ('owner','admin') OR q.assigned_to=p.id)
   AND EXISTS(SELECT 1 FROM quotation_sales_notes n WHERE n.quotation_id=q.id AND n.follow_up_date IS NOT NULL AND e.source_key LIKE 'quotation:'||q.id||':'||n.version||':%')) THEN RETURN NULL; END IF;
 IF e.target_kind='appointment' AND NOT EXISTS(SELECT 1 FROM job_appointments j WHERE j.id=e.target_id AND j.account_id=e.account_id
   AND (e.type='appointment_changed' OR j.status='reserved') AND (e.source_key='appointment-due:'||j.id||':'||j.revision OR e.source_key='appointment:'||j.id||':'||j.revision||':'||j.status) AND (p.account_role IN ('owner','admin') OR j.responsible_profile_id=p.id)) THEN RETURN NULL; END IF;
 NEW.target_kind:=e.target_kind; NEW.target_id:=e.target_id; NEW.source_reference:=e.source_reference;
 NEW.copy_key:=e.copy_key; NEW.category:=e.category; NEW.priority:=e.priority; NEW.source_key:=e.source_key;
 RETURN NEW;
END $$;
CREATE TRIGGER hydrate_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION hydrate_notification();
CREATE FUNCTION capture_review_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c conversations; kind text;
BEGIN
 IF NEW.outcome<>'failed' OR NOT (coalesce(NEW.details->>'reviewRequired'='true',false) OR NEW.reason IN ('reply_needs_review','unverified_price','empty_reply','provider_unavailable')) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM conversations WHERE id=NEW.conversation_id AND account_id=NEW.account_id;
 kind:=CASE WHEN NEW.reason LIKE 'media_%' THEN 'media_review_required' ELSE 'reply_review_required' END;
 INSERT INTO notifications(account_id,user_id,conversation_id,contact_id,type,title,body,source_key)
 SELECT c.account_id,p.user_id,c.id,c.contact_id,kind,'Customer request needs review',NEW.reason,
 'review:'||coalesce(NEW.trigger_message_id,NEW.id::text)||':'||kind||':'||NEW.reason
 FROM profiles p WHERE p.account_id=c.account_id AND p.account_role IN ('owner','admin','agent') AND
 (p.user_id=c.assigned_agent_id OR (NOT EXISTS(SELECT 1 FROM profiles owner WHERE owner.user_id=c.assigned_agent_id AND owner.account_id=c.account_id AND owner.account_role IN ('owner','admin','agent')) AND p.account_role IN ('owner','admin')));
 RETURN NEW;
END $$;
CREATE TRIGGER capture_review_notification AFTER INSERT ON ai_reply_events FOR EACH ROW EXECUTE FUNCTION capture_review_notification();
CREATE FUNCTION capture_media_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c conversations;
BEGIN
 IF NEW.status='accepted' AND NEW.status IS DISTINCT FROM OLD.status THEN
 UPDATE notification_events SET delivered_at=coalesce(delivered_at,now()),acknowledged_at=coalesce(acknowledged_at,now()) WHERE source_key='media:'||NEW.account_id||':'||NEW.conversation_id||':'||NEW.trigger_message_id||':'||NEW.file_id;
 UPDATE notifications SET resolved_at=now() WHERE source_key='media:'||NEW.account_id||':'||NEW.conversation_id||':'||NEW.trigger_message_id||':'||NEW.file_id AND resolved_at IS NULL;
 END IF;
 IF NEW.status NOT IN ('failed','uncertain') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT * INTO c FROM conversations WHERE id=NEW.conversation_id AND account_id=NEW.account_id;
 INSERT INTO notifications(account_id,user_id,conversation_id,contact_id,type,title,body,source_key)
 SELECT c.account_id,p.user_id,c.id,c.contact_id,'media_review_required','Attachment needs review',NEW.failure_code,'media:'||NEW.account_id||':'||NEW.conversation_id||':'||NEW.trigger_message_id||':'||NEW.file_id
 FROM profiles p WHERE p.account_id=c.account_id AND p.account_role IN ('owner','admin','agent') AND
 (p.user_id=c.assigned_agent_id OR (NOT EXISTS(SELECT 1 FROM profiles owner WHERE owner.user_id=c.assigned_agent_id AND owner.account_id=c.account_id AND owner.account_role IN ('owner','admin','agent')) AND p.account_role IN ('owner','admin')));
 RETURN NEW;
END $$;
CREATE TRIGGER capture_media_notification AFTER UPDATE ON ai_media_actions FOR EACH ROW EXECUTE FUNCTION capture_media_notification();
CREATE FUNCTION enqueue_operation_notice(p_account uuid,p_owner uuid,p_key text,p_type text,p_kind text,p_target uuid,p_reference text,p_deadline timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO notification_events(account_id,user_id,event_key,source_key,type,title,body,target_kind,target_id,source_reference,valid_until)
 SELECT p_account,p.user_id,p_key,p_key,p_type,'Work needs attention',p_reference,p_kind,p_target,p_reference,p_deadline
 FROM profiles p WHERE p.account_id=p_account AND p.account_role IN ('owner','admin','agent') AND
 (p.user_id=p_owner OR (NOT EXISTS(SELECT 1 FROM profiles owner WHERE owner.user_id=p_owner AND owner.account_id=p_account AND owner.account_role IN ('owner','admin','agent')) AND p.account_role IN ('owner','admin')))
 ON CONFLICT(account_id,user_id,event_key) DO NOTHING;
END $$;
CREATE FUNCTION capture_appointment_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision AND NEW.status=OLD.status THEN RETURN NEW; END IF;
 SELECT user_id INTO owner FROM profiles WHERE id=NEW.responsible_profile_id AND account_id=NEW.account_id;
 PERFORM enqueue_operation_notice(NEW.account_id,owner,'appointment:'||NEW.id||':'||NEW.revision||':'||NEW.status,'appointment_changed','appointment',NEW.id,NEW.kind,NEW.ends_at);
 RETURN NEW;
END $$;
CREATE TRIGGER capture_appointment_notice AFTER INSERT OR UPDATE ON job_appointments FOR EACH ROW EXECUTE FUNCTION capture_appointment_notice();
CREATE FUNCTION acknowledge_notification(p_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 UPDATE notifications SET acknowledged_at=coalesce(acknowledged_at,now()) WHERE id=p_id AND user_id=auth.uid();
$$;
CREATE FUNCTION sync_notification_ack() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.acknowledged_at IS NOT NULL AND OLD.acknowledged_at IS NULL THEN
  UPDATE notification_events SET acknowledged_at=NEW.acknowledged_at WHERE id=NEW.event_id AND user_id=NEW.user_id;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER sync_notification_ack AFTER UPDATE OF acknowledged_at ON notifications FOR EACH ROW EXECUTE FUNCTION sync_notification_ack();
CREATE FUNCTION sync_task_notification_ack() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IN ('acknowledged','completed','cancelled','deferred') AND NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE notification_events SET acknowledged_at=now() WHERE followup_id=NEW.id AND acknowledged_at IS NULL;
  UPDATE notifications SET acknowledged_at=now() WHERE followup_id=NEW.id AND acknowledged_at IS NULL;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER sync_task_notification_ack AFTER UPDATE OF status ON ai_followups FOR EACH ROW EXECUTE FUNCTION sync_task_notification_ack();
CREATE FUNCTION notification_target_visible(p_kind text,p_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_kind='quotation' THEN EXISTS(SELECT 1 FROM quotations WHERE id=p_target)
 WHEN p_kind='appointment' THEN EXISTS(SELECT 1 FROM job_appointments WHERE id=p_target) ELSE true END;
$$;
DROP POLICY notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated USING
 (user_id=auth.uid() AND is_account_member(account_id) AND notification_target_visible(target_kind,target_id)
 AND (conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=notifications.conversation_id AND c.account_id=notifications.account_id)));
CREATE FUNCTION set_notification_channels(p_account uuid,p_foreground boolean,p_sound boolean,p_supervise boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO notification_preferences(account_id,user_id,foreground_enabled,sound_enabled,supervise_messages)
 VALUES(p_account,auth.uid(),p_foreground,p_sound,p_supervise)
 ON CONFLICT(account_id,user_id) DO UPDATE SET foreground_enabled=EXCLUDED.foreground_enabled,sound_enabled=EXCLUDED.sound_enabled,supervise_messages=EXCLUDED.supervise_messages;
END $$;
-- Permission to supervise does not mean every administrator must be interrupted.
CREATE OR REPLACE FUNCTION notification_push_allowed(p_device uuid,p_kind text,p_source uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT CASE WHEN p_kind='notification' THEN n.resolved_at IS NULL AND n.acknowledged_at IS NULL AND notification_category(n.type)=ANY(coalesce(pref.push_categories,ARRAY['assignments','attention','followups','system','jobs']))
 ELSE 'assignments'=ANY(coalesce(pref.push_categories,ARRAY['assignments','attention','followups','system','jobs'])) AND
  (c.assigned_agent_id=d.user_id OR c.assigned_agent_id IS NULL OR coalesce(pref.supervise_messages,false)) END
 FROM mobile_push_devices d LEFT JOIN notification_preferences pref ON pref.account_id=d.account_id AND pref.user_id=d.user_id
 LEFT JOIN notifications n ON p_kind='notification' AND n.id=p_source AND n.user_id=d.user_id AND n.account_id=d.account_id
 LEFT JOIN messages m ON p_kind='message' AND m.id=p_source LEFT JOIN conversations c ON c.id=m.conversation_id AND c.account_id=d.account_id
 WHERE d.id=p_device),false);
$$;
CREATE FUNCTION maintain_notifications() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q record; j record; e notification_events; pol notification_account_policy; owner uuid; n integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(1042211) THEN RETURN 0; END IF;
 INSERT INTO notification_account_policy(account_id) SELECT id FROM accounts ON CONFLICT DO NOTHING;
 FOR pol IN SELECT * FROM notification_account_policy LOOP
  FOR q IN SELECT quotes.id,quotes.reference,person.user_id,notes.version,notes.follow_up_date FROM quotation_sales_notes notes
   JOIN quotations quotes ON quotes.id=notes.quotation_id AND quotes.account_id=notes.account_id
   LEFT JOIN profiles person ON person.id=quotes.assigned_to AND person.account_id=quotes.account_id
   WHERE quotes.account_id=pol.account_id AND quotes.archived_at IS NULL AND quotes.status IN ('draft','sent')
   AND notes.follow_up_date<=(now() AT TIME ZONE pol.timezone)::date
   AND notes.follow_up_date>=(pol.activated_at AT TIME ZONE pol.timezone)::date
   AND NOT EXISTS(SELECT 1 FROM notification_events ne WHERE ne.account_id=quotes.account_id AND ne.event_key='quotation:'||quotes.id||':'||notes.version||':'||(now() AT TIME ZONE pol.timezone)::date AND (person.user_id IS NULL OR ne.user_id=person.user_id))
   ORDER BY notes.follow_up_date,quotes.id LIMIT 100 LOOP
   PERFORM enqueue_operation_notice(pol.account_id,q.user_id,'quotation:'||q.id||':'||q.version||':'||(now() AT TIME ZONE pol.timezone)::date,
    'quotation_followup_due','quotation',q.id,q.reference);
  END LOOP;
  FOR j IN SELECT a.*,p.user_id FROM job_appointments a LEFT JOIN profiles p ON p.id=a.responsible_profile_id AND p.account_id=a.account_id
   WHERE a.account_id=pol.account_id AND a.status='reserved' AND a.starts_at BETWEEN now()-interval '15 minutes' AND now()+interval '1 hour'
   AND NOT EXISTS(SELECT 1 FROM notification_events ne WHERE ne.account_id=a.account_id AND ne.event_key='appointment-due:'||a.id||':'||a.revision AND (p.user_id IS NULL OR ne.user_id=p.user_id))
   ORDER BY a.starts_at,a.id LIMIT 100 LOOP
   PERFORM enqueue_operation_notice(pol.account_id,j.user_id,'appointment-due:'||j.id||':'||j.revision,'appointment_due','appointment',j.id,j.kind,j.ends_at);
  END LOOP;
 END LOOP;
 -- Recorded human response or source resolution ends escalation; opening/read state does not.
 UPDATE notification_events resolved SET acknowledged_at=now() WHERE resolved.acknowledged_at IS NULL AND
 ((resolved.followup_id IS NOT NULL AND EXISTS(SELECT 1 FROM ai_followups f WHERE f.id=resolved.followup_id AND f.status IN ('acknowledged','completed','cancelled','deferred')))
 OR (resolved.conversation_id IS NOT NULL AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=resolved.conversation_id AND m.sender_type='agent' AND NOT coalesce(m.ai_generated,false) AND m.created_at>resolved.created_at))
 OR (resolved.conversation_id IS NOT NULL AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=resolved.conversation_id AND c.status='closed'))
 OR (resolved.type='urgent_lead' AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=resolved.conversation_id AND c.ai_priority IS DISTINCT FROM 'urgent'))
 OR (resolved.type='ai_handoff' AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=resolved.conversation_id AND NOT c.ai_autoreply_disabled))
 OR (resolved.type='ai_key_invalid' AND NOT EXISTS(SELECT 1 FROM ai_configs c WHERE c.account_id=resolved.account_id AND c.last_key_error IS NOT NULL)));
 UPDATE notifications n SET acknowledged_at=ev.acknowledged_at FROM notification_events ev WHERE n.event_id=ev.id AND n.acknowledged_at IS NULL AND ev.acknowledged_at IS NOT NULL;
 FOR e IN SELECT ev.* FROM notification_events ev JOIN notification_account_policy p ON p.account_id=ev.account_id
  WHERE p.escalation_enabled AND ev.priority='high' AND ev.type<>'escalation' AND ev.acknowledged_at IS NULL AND ev.escalated_at IS NULL
  AND ev.created_at>=p.activated_at AND ev.created_at<now()-make_interval(mins=>p.escalation_minutes)
  AND (ev.valid_until IS NULL OR ev.valid_until>now()) ORDER BY ev.created_at LIMIT 100 FOR UPDATE OF ev SKIP LOCKED LOOP
  INSERT INTO notification_events(account_id,user_id,event_key,type,conversation_id,contact_id,followup_id,title,body,parent_event_id,target_kind,target_id,source_reference)
  SELECT e.account_id,p.user_id,'escalation:'||e.id,'escalation',e.conversation_id,e.contact_id,e.followup_id,'Unacknowledged work needs attention',e.type,e.id,e.target_kind,e.target_id,e.source_reference
  FROM profiles p WHERE p.account_id=e.account_id AND p.account_role IN ('owner','admin') AND p.user_id<>e.user_id
  ON CONFLICT(account_id,user_id,event_key) DO NOTHING;
  UPDATE notification_events SET escalated_at=now() WHERE id=e.id;
 END LOOP;
 n:=drain_notification_events(100);
 INSERT INTO notification_worker_health(id,last_success_at,processed) VALUES(true,now(),n)
 ON CONFLICT(id) DO UPDATE SET last_success_at=EXCLUDED.last_success_at,processed=EXCLUDED.processed;
 RETURN n;
END $$;
CREATE FUNCTION notification_operations_ready() RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT to_regprocedure('maintain_notifications()') IS NOT NULL AND to_regclass('notification_worker_health') IS NOT NULL
 AND has_function_privilege('service_role','maintain_notifications()','EXECUTE')
 AND NOT has_function_privilege('authenticated','maintain_notifications()','EXECUTE')
 AND (SELECT count(*)=4 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D' AND tgname IN
 ('capture_review_notification','capture_media_notification','capture_appointment_notice','hydrate_notification'));
$$;
REVOKE ALL ON FUNCTION notification_metadata(),hydrate_notification(),capture_review_notification(),capture_media_notification(),enqueue_operation_notice(uuid,uuid,text,text,text,uuid,text,timestamptz),capture_appointment_notice(),sync_notification_ack(),sync_task_notification_ack(),maintain_notifications(),notification_operations_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintain_notifications(),notification_operations_ready() TO service_role;
REVOKE ALL ON FUNCTION acknowledge_notification(uuid),set_notification_channels(uuid,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION acknowledge_notification(uuid),set_notification_channels(uuid,boolean,boolean,boolean) TO authenticated;
CREATE FUNCTION validate_notification_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_notification_policy BEFORE INSERT OR UPDATE ON notification_account_policy FOR EACH ROW EXECUTE FUNCTION validate_notification_policy();
REVOKE ALL ON FUNCTION validate_notification_policy() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION resolve_target_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE kind text; target uuid;
BEGIN
 IF TG_TABLE_NAME='job_appointments' THEN
  IF NEW.revision=OLD.revision AND NEW.status=OLD.status THEN RETURN NEW; END IF;
  kind:='appointment';target:=NEW.id;
 ELSIF TG_TABLE_NAME='quotation_sales_notes' THEN kind:='quotation';target:=NEW.quotation_id;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
  kind:='quotation';target:=NEW.id;
 END IF;
 UPDATE notification_events SET delivered_at=coalesce(delivered_at,now()),acknowledged_at=coalesce(acknowledged_at,now()) WHERE target_kind=kind AND target_id=target;
 UPDATE notifications SET resolved_at=now() WHERE target_kind=kind AND target_id=target AND resolved_at IS NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER resolve_appointment_notices BEFORE UPDATE ON job_appointments FOR EACH ROW EXECUTE FUNCTION resolve_target_notifications();
CREATE TRIGGER resolve_quotation_notices AFTER UPDATE ON quotation_sales_notes FOR EACH ROW EXECUTE FUNCTION resolve_target_notifications();
CREATE TRIGGER resolve_quotation_state_notices AFTER UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION resolve_target_notifications();
REVOKE ALL ON FUNCTION resolve_target_notifications() FROM PUBLIC,anon,authenticated;
CREATE INDEX notification_events_source ON notification_events(account_id,event_key);
CREATE FUNCTION retry_notification_events(p_account uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF NOT is_account_member(p_account,'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 UPDATE notification_events SET attempts=0,available_at=now(),last_error=NULL WHERE account_id=p_account AND delivered_at IS NULL AND attempts>=10;
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed;
END $$;
CREATE FUNCTION notification_worker_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('healthy',coalesce((SELECT last_success_at>now()-interval '3 minutes' FROM notification_worker_health WHERE id),false),
 'failed',(SELECT count(*) FROM notification_events WHERE delivered_at IS NULL AND attempts>=10));
$$;
REVOKE ALL ON FUNCTION retry_notification_events(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION retry_notification_events(uuid) TO authenticated;
REVOKE ALL ON FUNCTION notification_worker_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION notification_worker_status() TO service_role;
CREATE FUNCTION set_notification_channel_policy(p_account uuid,p_foreground boolean,p_sound boolean,p_supervise boolean,p_start integer,p_end integer,p_timezone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_account_member(p_account,'agent') THEN RAISE EXCEPTION 'Agent required' USING ERRCODE='42501'; END IF;
 IF (p_start IS NULL)<>(p_end IS NULL) OR p_start NOT BETWEEN 0 AND 1439 OR p_end NOT BETWEEN 0 AND 1439
 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid quiet hours' USING ERRCODE='22023'; END IF;
 PERFORM set_notification_channels(p_account,p_foreground,p_sound,p_supervise);
 INSERT INTO mobile_push_preferences(user_id,account_id,quiet_start,quiet_end,timezone) VALUES(auth.uid(),p_account,p_start,p_end,p_timezone)
 ON CONFLICT(user_id,account_id) DO UPDATE SET quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,timezone=EXCLUDED.timezone;
END $$;
REVOKE ALL ON FUNCTION set_notification_channel_policy(uuid,boolean,boolean,boolean,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION set_notification_channel_policy(uuid,boolean,boolean,boolean,integer,integer,text) TO authenticated;
COMMIT;
