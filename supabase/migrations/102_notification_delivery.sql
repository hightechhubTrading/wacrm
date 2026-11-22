-- Durable recipient events. Business state and notification intent commit together.
BEGIN;
ALTER TABLE public.conversations ADD COLUMN notification_handoff_revision uuid, ADD COLUMN notification_urgent_revision uuid;
ALTER TABLE public.ai_configs ADD COLUMN notification_error_revision uuid;
ALTER TABLE public.notifications ADD COLUMN resolved_at timestamptz, ADD COLUMN event_id uuid, ADD COLUMN followup_id uuid REFERENCES public.ai_followups(id) ON DELETE SET NULL;
CREATE TABLE public.notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, event_key text NOT NULL,
 type text NOT NULL CHECK(type IN ('conversation_assigned','ai_key_invalid','urgent_lead','ai_handoff','followup_due','reply_review_required','media_review_required')), conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL, actor_user_id uuid,
 followup_id uuid REFERENCES public.ai_followups(id) ON DELETE SET NULL,
 title text NOT NULL, body text, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), last_error text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
 UNIQUE(account_id,user_id,event_key)
);
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.notification_events TO service_role;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_event_fk FOREIGN KEY(event_id) REFERENCES public.notification_events(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX notifications_event_recipient ON public.notifications(event_id,user_id) WHERE event_id IS NOT NULL;
CREATE INDEX notification_events_pending ON public.notification_events(created_at,id) WHERE delivered_at IS NULL;

-- Legacy producers retain their insert contract, but now stage durable intent.
-- Only the drain writes visible rows; the existing push trigger then schedules devices.
CREATE FUNCTION public.stage_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE episode uuid; due timestamptz; k text;
BEGIN
 IF NEW.event_id IS NOT NULL THEN RETURN NEW; END IF;
 k:=gen_random_uuid()::text;
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
 INSERT INTO notification_events(account_id,user_id,event_key,type,conversation_id,contact_id,actor_user_id,followup_id,title,body)
 VALUES(NEW.account_id,NEW.user_id,k,NEW.type,NEW.conversation_id,NEW.contact_id,NEW.actor_user_id,NEW.followup_id,NEW.title,NEW.body)
 ON CONFLICT(account_id,user_id,event_key) DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER stage_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.stage_notification();

-- Persist a new handoff episode only when an actual handoff state changes.
CREATE FUNCTION public.notification_handoff_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 NEW.notification_handoff_revision:=OLD.notification_handoff_revision;
 NEW.notification_urgent_revision:=OLD.notification_urgent_revision;
 IF NEW.ai_priority='urgent' AND NEW.ai_priority IS DISTINCT FROM OLD.ai_priority THEN NEW.notification_urgent_revision:=gen_random_uuid(); END IF;
 IF NEW.ai_autoreply_disabled AND NEW.ai_handoff_summary IS NOT NULL AND
   (NOT COALESCE(OLD.ai_autoreply_disabled,false) OR NEW.ai_handoff_summary IS DISTINCT FROM OLD.ai_handoff_summary
    OR NEW.ai_handoff_reason IS DISTINCT FROM OLD.ai_handoff_reason) THEN
   NEW.notification_handoff_revision:=gen_random_uuid();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_handoff_revision BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.notification_handoff_revision();

CREATE FUNCTION public.capture_notification_handoff() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.notification_handoff_revision IS NOT DISTINCT FROM OLD.notification_handoff_revision THEN RETURN NEW; END IF;
 INSERT INTO notifications(account_id,user_id,type,conversation_id,contact_id,title,body)
 SELECT NEW.account_id,p.user_id,'ai_handoff',NEW.id,NEW.contact_id,'AI assistant handed off a conversation',NEW.ai_handoff_summary
 FROM profiles p WHERE p.account_id=NEW.account_id AND p.account_role IN ('owner','admin','agent')
 AND (p.user_id=NEW.assigned_agent_id OR (NOT EXISTS(SELECT 1 FROM profiles a WHERE a.user_id=NEW.assigned_agent_id
   AND a.account_id=NEW.account_id AND a.account_role IN ('owner','admin','agent')) AND p.account_role IN ('owner','admin')));
 RETURN NEW;
END $$;
CREATE TRIGGER capture_notification_handoff AFTER UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.capture_notification_handoff();

-- The paired assignment event is suppressed by explicit source revision, not time.
CREATE OR REPLACE FUNCTION public.notify_conversation_assigned() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.assigned_agent_id IS NULL OR auth.uid()=NEW.assigned_agent_id THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN RETURN NEW; END IF;
   IF NEW.notification_handoff_revision IS DISTINCT FROM OLD.notification_handoff_revision THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO notifications(account_id,user_id,type,conversation_id,contact_id,actor_user_id,title,body)
 VALUES(NEW.account_id,NEW.assigned_agent_id,'conversation_assigned',NEW.id,NEW.contact_id,auth.uid(),
 'New conversation assigned','A conversation has been assigned to you.');
 RETURN NEW;
END $$;

CREATE FUNCTION public.drain_notification_events(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e notification_events; delivered integer:=0;
BEGIN
 FOR e IN SELECT * FROM notification_events WHERE delivered_at IS NULL AND attempts<10 AND available_at<=now() ORDER BY created_at,id
   LIMIT greatest(0,least(p_limit,500)) FOR UPDATE SKIP LOCKED LOOP
   BEGIN
   -- Current membership and conversation assignment are rechecked at fanout.
   IF EXISTS(SELECT 1 FROM profiles p WHERE p.account_id=e.account_id AND p.user_id=e.user_id
     AND p.account_role IN ('owner','admin','agent')
     AND (e.followup_id IS NULL OR EXISTS(SELECT 1 FROM ai_followups f WHERE f.id=e.followup_id AND f.account_id=e.account_id AND f.conversation_id=e.conversation_id AND f.status IN ('open','acknowledged','deferred') AND f.due_at<=now()))
     AND (e.conversation_id IS NULL OR EXISTS(
       SELECT 1 FROM conversations c WHERE c.id=e.conversation_id AND c.account_id=e.account_id
       AND (c.assigned_agent_id=p.user_id OR p.account_role IN ('owner','admin'))))) THEN
     INSERT INTO notifications(account_id,user_id,type,conversation_id,contact_id,actor_user_id,followup_id,title,body,event_id,created_at)
     VALUES(e.account_id,e.user_id,e.type,e.conversation_id,e.contact_id,e.actor_user_id,e.followup_id,e.title,e.body,e.id,e.created_at)
     ON CONFLICT DO NOTHING;
     delivered:=delivered+1;
   END IF;
   UPDATE notification_events SET delivered_at=now() WHERE id=e.id;
   EXCEPTION WHEN OTHERS THEN
     UPDATE notification_events SET attempts=attempts+1,available_at=now()+interval '1 minute',last_error=SQLSTATE WHERE id=e.id;
   END;
 END LOOP;
 RETURN delivered;
END $$;
REVOKE ALL ON FUNCTION public.stage_notification(),public.notification_handoff_revision(),public.capture_notification_handoff(),public.notify_conversation_assigned(),public.drain_notification_events(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.drain_notification_events(integer) TO service_role;
CREATE TABLE public.notification_preferences (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 push_categories text[] NOT NULL DEFAULT ARRAY['assignments','attention','followups','system'],
 PRIMARY KEY(account_id,user_id),
 CHECK(push_categories <@ ARRAY['assignments','attention','followups','system']::text[])
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_self ON notification_preferences FOR ALL TO authenticated
 USING(user_id=auth.uid() AND is_account_member(account_id,'agent'))
 WITH CHECK(user_id=auth.uid() AND is_account_member(account_id,'agent'));
REVOKE ALL ON notification_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON notification_preferences TO authenticated;
GRANT UPDATE(push_categories) ON notification_preferences TO authenticated;
GRANT ALL ON notification_preferences TO service_role;
CREATE FUNCTION notification_category(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_type WHEN 'conversation_assigned' THEN 'assignments' WHEN 'ai_key_invalid' THEN 'system'
 WHEN 'followup_due' THEN 'followups' ELSE 'attention' END;
$$;
CREATE FUNCTION set_notification_categories(p_account uuid,p_categories text[]) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO notification_preferences(account_id,user_id,push_categories) VALUES(p_account,auth.uid(),p_categories)
 ON CONFLICT(account_id,user_id) DO UPDATE SET push_categories=EXCLUDED.push_categories;
END $$;
REVOKE ALL ON FUNCTION set_notification_categories(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION set_notification_categories(uuid,text[]) TO authenticated;
-- Apply category policy both when scheduling and immediately before transport.
CREATE FUNCTION notification_push_allowed(p_device uuid,p_kind text,p_source uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT CASE WHEN p_kind='notification' THEN notification_category(n.type)=ANY(pref.push_categories)
   ELSE 'assignments'=ANY(pref.push_categories) END
 FROM mobile_push_devices d JOIN notification_preferences pref ON pref.account_id=d.account_id AND pref.user_id=d.user_id
 LEFT JOIN notifications n ON p_kind='notification' AND n.id=p_source AND n.user_id=d.user_id AND n.account_id=d.account_id
 WHERE d.id=p_device),true);
$$;
CREATE FUNCTION filter_notification_push() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT notification_push_allowed(NEW.device_id,NEW.kind,NEW.source_id) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER filter_notification_push BEFORE INSERT ON mobile_push_jobs FOR EACH ROW EXECUTE FUNCTION filter_notification_push();
ALTER FUNCTION prepare_mobile_push_job(uuid,uuid) RENAME TO prepare_mobile_push_job_base;
REVOKE ALL ON FUNCTION prepare_mobile_push_job_base(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prepare_mobile_push_job(p_id uuid,p_lease uuid)
RETURNS TABLE(job_id uuid,device_id uuid,token_ciphertext text,token_hash text,account_id uuid,
 conversation_id uuid,attempts integer,valid_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j mobile_push_jobs;
BEGIN
 SELECT * INTO j FROM mobile_push_jobs WHERE id=p_id AND state='leased' AND lease_token=p_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT notification_push_allowed(j.device_id,j.kind,j.source_id) THEN
  UPDATE mobile_push_jobs SET state='discarded',outcome='access_or_preference',lease_token=NULL,lease_until=NULL WHERE id=j.id;
  RETURN;
 END IF;
 RETURN QUERY SELECT * FROM prepare_mobile_push_job_base(p_id,p_lease);
END $$;
REVOKE ALL ON FUNCTION notification_push_allowed(uuid,text,uuid),filter_notification_push(),prepare_mobile_push_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION prepare_mobile_push_job(uuid,uuid) TO service_role;
CREATE FUNCTION resolve_followup_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IN ('completed','cancelled') OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
   UPDATE notification_events SET delivered_at=coalesce(delivered_at,now()) WHERE followup_id=NEW.id;
   UPDATE notifications SET resolved_at=now() WHERE followup_id=NEW.id AND resolved_at IS NULL;
   UPDATE mobile_push_jobs j SET state='discarded',outcome='access_or_preference',lease_token=NULL,lease_until=NULL
     FROM notifications n WHERE j.kind='notification' AND j.source_id=n.id AND n.followup_id=NEW.id AND j.state IN ('pending','leased');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION resolve_followup_notifications() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER resolve_followup_notifications AFTER UPDATE OF status,due_at ON ai_followups FOR EACH ROW EXECUTE FUNCTION resolve_followup_notifications();
CREATE FUNCTION capture_notification_urgent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.notification_urgent_revision IS NOT DISTINCT FROM OLD.notification_urgent_revision THEN RETURN NEW; END IF;
 INSERT INTO notifications(account_id,user_id,type,conversation_id,contact_id,title,body)
 SELECT NEW.account_id,p.user_id,'urgent_lead',NEW.id,NEW.contact_id,'Urgent conversation needs attention',NEW.ai_priority_reason
 FROM profiles p WHERE p.account_id=NEW.account_id AND p.account_role IN ('owner','admin','agent')
 AND (p.user_id=NEW.assigned_agent_id OR (NOT EXISTS(SELECT 1 FROM profiles a WHERE a.user_id=NEW.assigned_agent_id
   AND a.account_id=NEW.account_id AND a.account_role IN ('owner','admin','agent')) AND p.account_role IN ('owner','admin')));
 RETURN NEW;
END $$;
CREATE TRIGGER capture_notification_urgent AFTER UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION capture_notification_urgent();
CREATE FUNCTION notification_key_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 NEW.notification_error_revision:=OLD.notification_error_revision;
 IF NEW.last_key_error IS NOT NULL AND OLD.last_key_error IS NULL THEN NEW.notification_error_revision:=gen_random_uuid(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_key_revision BEFORE UPDATE ON ai_configs FOR EACH ROW EXECUTE FUNCTION notification_key_revision();
CREATE FUNCTION capture_notification_key() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.notification_error_revision IS NOT DISTINCT FROM OLD.notification_error_revision THEN RETURN NEW; END IF;
 INSERT INTO notifications(account_id,user_id,type,title,body)
 SELECT NEW.account_id,p.user_id,'ai_key_invalid','AI assistant key stopped working','Check the AI provider configuration.'
 FROM profiles p WHERE p.account_id=NEW.account_id AND p.account_role IN ('owner','admin');
 RETURN NEW;
END $$;
CREATE TRIGGER capture_notification_key AFTER UPDATE ON ai_configs FOR EACH ROW EXECUTE FUNCTION capture_notification_key();
REVOKE ALL ON FUNCTION capture_notification_urgent(),notification_key_revision(),capture_notification_key() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION notification_delivery_ready() RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT to_regclass('notification_events') IS NOT NULL AND to_regclass('notification_preferences') IS NOT NULL
 AND NOT has_table_privilege('authenticated','notification_events','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_function_privilege('authenticated','drain_notification_events(integer)','EXECUTE')
 AND has_function_privilege('service_role','drain_notification_events(integer)','EXECUTE')
 AND NOT has_function_privilege('service_role','prepare_mobile_push_job_base(uuid,uuid)','EXECUTE')
 AND (SELECT count(*)=7 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D' AND tgname IN
 ('stage_notification','notification_handoff_revision','capture_notification_handoff','resolve_followup_notifications','capture_notification_urgent','capture_notification_key','filter_notification_push'));
$$;
REVOKE ALL ON FUNCTION notification_delivery_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION notification_delivery_ready() TO service_role;
COMMIT;
