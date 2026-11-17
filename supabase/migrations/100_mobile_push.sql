-- Private device credentials and durable Android push outbox. No client table
-- grants: mobile routes authenticate a human first; only service RPCs mutate it.
-- Meta's created_at is the sender timestamp, so recovery needs a separate local
-- insertion timestamp. A stable DEFAULT is a metadata-only add on supported PG.
ALTER TABLE public.messages ADD COLUMN mobile_push_recorded_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX messages_mobile_push_recorded ON public.messages(mobile_push_recorded_at) WHERE sender_type='customer';
CREATE TABLE public.mobile_push_devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_ciphertext text NOT NULL,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version>0),
  project_id text NOT NULL CHECK (project_id ~ '^[a-z][a-z0-9-]{4,61}[a-z0-9]$'),
  app_id text NOT NULL CHECK (app_id IN ('com.hightechhub.crm.demo','com.hightechhub.crm')),
  environment text NOT NULL CHECK (environment IN ('development','production')),
  enabled boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, environment, token_hash)
);
CREATE INDEX mobile_push_devices_user ON public.mobile_push_devices(user_id,account_id);
CREATE TABLE public.mobile_push_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  quiet_start integer CHECK (quiet_start BETWEEN 0 AND 1439),
  quiet_end integer CHECK (quiet_end BETWEEN 0 AND 1439),
  timezone text NOT NULL DEFAULT 'Asia/Qatar',
  PRIMARY KEY(user_id,account_id),
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);
CREATE TABLE public.mobile_push_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.mobile_push_devices(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('message','notification')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','accepted','discarded','dead')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
  lease_until timestamptz,
  lease_token uuid,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id,kind,source_id)
);
CREATE INDEX mobile_push_jobs_due ON public.mobile_push_jobs(available_at)
  WHERE state IN ('pending','leased');
ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_push_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_push_devices,public.mobile_push_preferences,public.mobile_push_jobs FROM anon,authenticated;
GRANT ALL ON public.mobile_push_devices,public.mobile_push_preferences,public.mobile_push_jobs TO service_role;

CREATE FUNCTION public.register_mobile_push_device(
  p_id uuid,p_account uuid,p_user uuid,p_session uuid,p_secret_hash text,
  p_token_hash text,p_ciphertext text,p_project text,p_app text,p_environment text,p_version integer DEFAULT 1
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=p_user AND account_id=p_account
    AND account_role IN ('owner','admin','agent'))
    OR NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
      WHERE s.id=p_session AND s.user_id=p_user AND (s.not_after IS NULL OR s.not_after>now())
        AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.deleted_at IS NULL)
    THEN RETURN false; END IF;
  -- Serialize registration/caps for this user, including concurrent new devices.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  IF EXISTS(SELECT 1 FROM mobile_push_devices WHERE id=p_id AND
    (user_id<>p_user OR account_id<>p_account OR session_id<>p_session OR secret_hash<>p_secret_hash
      OR project_id<>p_project OR app_id<>p_app OR environment<>p_environment))
    THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM mobile_push_devices WHERE id=p_id AND
    (token_version>p_version OR (token_version=p_version AND token_hash<>p_token_hash)
      OR (NOT enabled AND token_hash=p_token_hash))) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM mobile_push_devices WHERE id=p_id) AND
    (SELECT count(*) FROM mobile_push_devices WHERE user_id=p_user AND enabled
      AND last_seen_at>now()-interval '30 days')>=5 THEN RETURN false; END IF;
  INSERT INTO mobile_push_devices(id,account_id,user_id,session_id,secret_hash,token_hash,
    token_ciphertext,project_id,app_id,environment,token_version)
    VALUES(p_id,p_account,p_user,p_session,p_secret_hash,p_token_hash,p_ciphertext,p_project,p_app,p_environment,p_version)
    ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash,token_ciphertext=EXCLUDED.token_ciphertext,
      token_version=EXCLUDED.token_version,enabled=true,last_seen_at=now();
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END $$;

CREATE FUNCTION public.revoke_mobile_push_device(p_id uuid,p_secret_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  DELETE FROM mobile_push_devices WHERE id=p_id AND secret_hash=p_secret_hash;
$$;

CREATE FUNCTION public.set_mobile_push_preferences(p_account uuid,p_user uuid,
  p_enabled boolean,p_quiet_start integer,p_quiet_end integer,p_timezone text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=p_user AND account_id=p_account
    AND account_role IN ('owner','admin','agent'))
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)
    THEN RETURN false; END IF;
  INSERT INTO mobile_push_preferences(user_id,account_id,enabled,quiet_start,quiet_end,timezone)
    VALUES(p_user,p_account,p_enabled,p_quiet_start,p_quiet_end,p_timezone)
    ON CONFLICT(user_id,account_id) DO UPDATE SET enabled=EXCLUDED.enabled,
      quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,timezone=EXCLUDED.timezone;
  RETURN true;
END $$;

CREATE FUNCTION public.enqueue_mobile_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account uuid; v_conversation uuid; v_recipient uuid; v_kind text;
BEGIN
  IF TG_TABLE_NAME='messages' THEN
    IF NEW.sender_type<>'customer' THEN RETURN NEW; END IF;
    SELECT account_id INTO v_account FROM conversations WHERE id=NEW.conversation_id;
    v_conversation:=NEW.conversation_id; v_kind:='message';
  ELSE
    v_account:=NEW.account_id; v_conversation:=NEW.conversation_id;
    v_recipient:=NEW.user_id; v_kind:='notification';
  END IF;
  INSERT INTO mobile_push_jobs(device_id,account_id,conversation_id,source_id,kind,expires_at)
    SELECT d.id,v_account,v_conversation,NEW.id,v_kind,
      now()+CASE WHEN v_kind='message' THEN interval '15 minutes' ELSE interval '1 hour' END FROM mobile_push_devices d
    JOIN profiles p ON p.user_id=d.user_id AND p.account_id=d.account_id
    WHERE d.account_id=v_account AND d.enabled AND d.last_seen_at>now()-interval '30 days'
      AND p.account_role IN ('owner','admin','agent')
      AND (v_recipient IS NULL OR d.user_id=v_recipient)
      AND (v_conversation IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=v_conversation
        AND c.account_id=v_account AND (c.assigned_agent_id=d.user_id OR p.account_role IN ('owner','admin'))))
    ON CONFLICT(device_id,kind,source_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Push must not interrupt existing message ingestion or assignment.
  RAISE WARNING 'Mobile push scheduling failed (%)',SQLSTATE;
  RETURN NEW;
END $$;
CREATE TRIGGER mobile_push_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_mobile_push();
CREATE TRIGGER mobile_push_notification AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_mobile_push();

CREATE FUNCTION public.claim_mobile_push_jobs(p_project text,p_environment text,p_app text,p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM mobile_push_jobs j USING mobile_push_devices d WHERE j.device_id=d.id
    AND d.project_id=p_project AND d.environment=p_environment AND d.app_id=p_app
    AND j.created_at<now()-interval '7 days';
  DELETE FROM mobile_push_devices WHERE project_id=p_project AND environment=p_environment AND app_id=p_app
    AND last_seen_at<now()-interval '30 days';
  -- Trigger scheduling is deliberately non-blocking for the existing CRM.
  -- Recover missing fanout from durable source rows, without replaying history
  -- from before this binding existed. NOT EXISTS avoids starving newer rows.
  INSERT INTO mobile_push_jobs(device_id,account_id,conversation_id,source_id,kind,expires_at)
    SELECT d.id,c.account_id,c.id,m.id,'message',m.mobile_push_recorded_at+interval '15 minutes'
    FROM messages m JOIN conversations c ON c.id=m.conversation_id
    JOIN mobile_push_devices d ON d.account_id=c.account_id
    JOIN profiles p ON p.user_id=d.user_id AND p.account_id=d.account_id
    WHERE m.sender_type='customer' AND m.mobile_push_recorded_at>now()-interval '15 minutes'
      AND m.mobile_push_recorded_at>=d.registered_at AND d.enabled
      AND d.project_id=p_project AND d.environment=p_environment AND d.app_id=p_app
      AND p.account_role IN ('owner','admin','agent')
      AND (p.account_role IN ('owner','admin') OR c.assigned_agent_id=d.user_id)
      AND NOT EXISTS(SELECT 1 FROM mobile_push_jobs j WHERE j.device_id=d.id AND j.kind='message' AND j.source_id=m.id)
    ORDER BY m.mobile_push_recorded_at,m.id,d.id LIMIT 100 ON CONFLICT DO NOTHING;
  INSERT INTO mobile_push_jobs(device_id,account_id,conversation_id,source_id,kind,expires_at)
    SELECT d.id,n.account_id,n.conversation_id,n.id,'notification',n.created_at+interval '1 hour'
    FROM notifications n JOIN mobile_push_devices d ON d.user_id=n.user_id AND d.account_id=n.account_id
    JOIN profiles p ON p.user_id=d.user_id AND p.account_id=d.account_id
    WHERE n.created_at>now()-interval '1 hour' AND n.created_at>=d.registered_at AND n.read_at IS NULL AND d.enabled
      AND d.project_id=p_project AND d.environment=p_environment AND d.app_id=p_app
      AND p.account_role IN ('owner','admin','agent')
      AND (n.conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=n.conversation_id
        AND c.account_id=d.account_id AND (p.account_role IN ('owner','admin') OR c.assigned_agent_id=d.user_id)))
      AND NOT EXISTS(SELECT 1 FROM mobile_push_jobs j WHERE j.device_id=d.id AND j.kind='notification' AND j.source_id=n.id)
    ORDER BY n.created_at,n.id,d.id LIMIT 100 ON CONFLICT DO NOTHING;
  UPDATE mobile_push_jobs j SET state='dead',outcome='expired',lease_token=NULL,lease_until=NULL
    FROM mobile_push_devices d WHERE d.id=j.device_id AND d.project_id=p_project
    AND d.environment=p_environment AND d.app_id=p_app AND j.state IN ('pending','leased')
    AND (j.expires_at<=now() OR (j.attempts>=5 AND (j.lease_until IS NULL OR j.lease_until<=now())));
  RETURN QUERY WITH due AS (
    SELECT j.id FROM mobile_push_jobs j JOIN mobile_push_devices d ON d.id=j.device_id
    WHERE d.project_id=p_project AND d.environment=p_environment AND d.app_id=p_app
      AND j.state IN ('pending','leased') AND j.available_at<=now()
      AND (j.lease_until IS NULL OR j.lease_until<=now()) AND j.attempts<5 AND j.expires_at>now()
    ORDER BY j.available_at,j.id LIMIT greatest(0,least(p_limit,20)) FOR UPDATE OF j SKIP LOCKED
  ) UPDATE mobile_push_jobs j SET state='leased',lease_token=gen_random_uuid(),
    lease_until=now()+interval '2 minutes',attempts=j.attempts+1
    FROM due WHERE j.id=due.id RETURNING j.id,j.lease_token;
END $$;

-- Re-evaluate immediately before transport. A queue snapshot grants no access.
CREATE FUNCTION public.prepare_mobile_push_job(p_id uuid,p_lease uuid)
RETURNS TABLE(job_id uuid,device_id uuid,token_ciphertext text,token_hash text,
  account_id uuid,conversation_id uuid,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j mobile_push_jobs; d mobile_push_devices; p profiles; pref mobile_push_preferences;
  local_now timestamp; minute_now integer; end_day date;
BEGIN
  SELECT * INTO j FROM mobile_push_jobs WHERE id=p_id AND state='leased' AND lease_token=p_lease
    AND lease_until>now() AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO d FROM mobile_push_devices WHERE id=j.device_id;
  SELECT pr.* INTO p FROM profiles pr WHERE pr.user_id=d.user_id AND pr.account_id=j.account_id;
  SELECT pr.* INTO pref FROM mobile_push_preferences pr WHERE pr.user_id=d.user_id AND pr.account_id=j.account_id;
  IF d.id IS NULL OR NOT d.enabled OR d.account_id<>j.account_id OR d.last_seen_at<=now()-interval '30 days'
    OR p.user_id IS NULL OR p.account_role NOT IN ('owner','admin','agent')
    OR NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
      WHERE s.id=d.session_id AND s.user_id=d.user_id AND (s.not_after IS NULL OR s.not_after>now())
        AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.deleted_at IS NULL)
    OR pref.enabled=false
    OR (j.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations c
      WHERE c.id=j.conversation_id AND c.account_id=j.account_id
        AND (p.account_role IN ('owner','admin') OR c.assigned_agent_id=d.user_id)))
    OR (j.kind='message' AND NOT EXISTS(SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE m.id=j.source_id AND m.sender_type='customer' AND c.id=j.conversation_id))
    OR (j.kind='notification' AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id=j.source_id
      AND n.user_id=d.user_id AND n.account_id=j.account_id AND n.read_at IS NULL))
  THEN UPDATE mobile_push_jobs SET state='discarded',outcome='access_or_preference',lease_token=NULL,lease_until=NULL WHERE id=j.id;
    RETURN; END IF;
  IF pref.quiet_start IS NOT NULL AND pref.quiet_start<>pref.quiet_end THEN
    local_now:=now() AT TIME ZONE pref.timezone;
    minute_now:=extract(hour FROM local_now)::integer*60+extract(minute FROM local_now)::integer;
    IF (pref.quiet_start<pref.quiet_end AND minute_now>=pref.quiet_start AND minute_now<pref.quiet_end)
      OR (pref.quiet_start>pref.quiet_end AND (minute_now>=pref.quiet_start OR minute_now<pref.quiet_end)) THEN
      end_day:=local_now::date;
      IF pref.quiet_start>pref.quiet_end AND minute_now>=pref.quiet_start THEN end_day:=end_day+1; END IF;
      UPDATE mobile_push_jobs SET state='pending',available_at=(end_day+make_interval(mins=>pref.quiet_end)) AT TIME ZONE pref.timezone,
        attempts=greatest(0,mobile_push_jobs.attempts-1),lease_token=NULL,lease_until=NULL WHERE id=j.id;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT j.id,d.id,d.token_ciphertext,d.token_hash,j.account_id,j.conversation_id,j.attempts;
END $$;

CREATE FUNCTION public.finish_mobile_push_job(p_id uuid,p_lease uuid,p_outcome text,p_retry_seconds integer DEFAULT 30,
  p_invalid_token_hash text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j mobile_push_jobs;
BEGIN
  IF p_outcome NOT IN ('accepted','retry','rejected','invalid_token') THEN RETURN false; END IF;
  SELECT * INTO j FROM mobile_push_jobs WHERE id=p_id AND state='leased' AND lease_token=p_lease FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_outcome='invalid_token' THEN
    UPDATE mobile_push_devices SET enabled=false WHERE id=j.device_id AND token_hash=p_invalid_token_hash;
  END IF;
  UPDATE mobile_push_jobs SET state=CASE WHEN p_outcome='accepted' THEN 'accepted'
      WHEN p_outcome='retry' AND j.attempts<5 AND now()<j.expires_at THEN 'pending' ELSE 'dead' END,
    outcome=p_outcome,available_at=now()+make_interval(secs=>greatest(1,least(p_retry_seconds,3600))),
    lease_token=NULL,lease_until=NULL WHERE id=j.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.register_mobile_push_device(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer),
  public.revoke_mobile_push_device(uuid,text),public.set_mobile_push_preferences(uuid,uuid,boolean,integer,integer,text),
  public.enqueue_mobile_push(),public.claim_mobile_push_jobs(text,text,text,integer),
  public.prepare_mobile_push_job(uuid,uuid),public.finish_mobile_push_job(uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_mobile_push_device(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer),
  public.revoke_mobile_push_device(uuid,text),public.set_mobile_push_preferences(uuid,uuid,boolean,integer,integer,text),
  public.claim_mobile_push_jobs(text,text,text,integer),public.prepare_mobile_push_job(uuid,uuid),
  public.finish_mobile_push_job(uuid,uuid,text,integer,text) TO service_role;

-- Read-only deployment sentinel: verify signatures/grants and source triggers
-- without claiming work, pruning credentials, or creating a registration.
CREATE FUNCTION public.mobile_push_ready() RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT coalesce((SELECT bool_and(c.relrowsecurity
    AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    AND NOT EXISTS(SELECT 1 FROM (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(name)
      WHERE NOT has_table_privilege('service_role',c.oid,privileges.name)))
    FROM pg_class c WHERE c.oid IN ('mobile_push_devices'::regclass,'mobile_push_preferences'::regclass,'mobile_push_jobs'::regclass)),false)
  AND (SELECT bool_and(to_regprocedure(signature) IS NOT NULL
    AND has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')
    AND NOT has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')
    AND NOT has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')) FROM (VALUES
      ('register_mobile_push_device(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer)'),
      ('revoke_mobile_push_device(uuid,text)'),
      ('set_mobile_push_preferences(uuid,uuid,boolean,integer,integer,text)'),
      ('claim_mobile_push_jobs(text,text,text,integer)'),
      ('prepare_mobile_push_job(uuid,uuid)'),
      ('finish_mobile_push_job(uuid,uuid,text,integer,text)')
    ) f(signature))
  AND (SELECT count(*)=2 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D'
    AND tgfoid='enqueue_mobile_push()'::regprocedure
    AND ((tgname='mobile_push_message' AND tgrelid='messages'::regclass)
      OR (tgname='mobile_push_notification' AND tgrelid='notifications'::regclass)))
  AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='messages'::regclass
    AND attname='mobile_push_recorded_at' AND attnotnull AND NOT attisdropped);
$$;
REVOKE ALL ON FUNCTION public.mobile_push_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_push_ready() TO service_role;
