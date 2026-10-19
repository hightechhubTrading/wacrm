-- Disposable, network-isolated database only, after migrations 001–076.
-- Run as database owner with stop-on-error. No extension/test runner required.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.record_webhook_failure(uuid,integer)', 'public.claim_ai_reply_slot(uuid,integer)'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(r,f,'EXECUTE') THEN
        RAISE EXCEPTION 'Internal RPC unexpectedly executable by %: %',r,f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role',f,'EXECUTE') THEN
      RAISE EXCEPTION 'Internal service RPC unavailable: %',f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.record_conversation_conversion(uuid,text,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous conversion RPC access';
  END IF;
END;
$$;

DO $$
DECLARE
  u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid();
  a1 uuid; a2 uuid; p1 uuid; p2 uuid; c1 uuid; n uuid:=gen_random_uuid();
  pipeline uuid; v_stage uuid; deal uuid; other_profile uuid;
BEGIN
  -- Signup trigger creates accounts/profiles. No real identity or provider.
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (u1,u1::text || '@example.invalid','{}'),
    (u2,u2::text || '@example.invalid','{}');
  SELECT account_id INTO STRICT a1 FROM public.profiles WHERE user_id=u1;
  SELECT account_id INTO STRICT a2 FROM public.profiles WHERE user_id=u2;
  INSERT INTO public.contacts(user_id,account_id,phone,name) VALUES(u1,a1,'+15550000001','Local dummy') RETURNING id INTO p1;
  INSERT INTO public.contacts(user_id,account_id,phone,name) VALUES(u2,a2,'+15550000002','Foreign dummy') RETURNING id INTO p2;
  INSERT INTO public.conversations(user_id,account_id,contact_id) VALUES(u1,a1,p1) RETURNING id INTO c1;

  BEGIN
    INSERT INTO public.conversations(user_id,account_id,contact_id) VALUES(u1,a1,p2);
    RAISE EXCEPTION 'Foreign contact accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.conversations SET contact_id=p2 WHERE id=c1;
    RAISE EXCEPTION 'Foreign contact update accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.contacts SET account_id=a2 WHERE id=p1;
    RAISE EXCEPTION 'Contact account move accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.conversations SET account_id=a2,contact_id=p2 WHERE id=c1;
    RAISE EXCEPTION 'Conversation account move accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- The insert trigger must discard a foreign recipient even for definer writes.
  INSERT INTO public.notifications(id,account_id,user_id,type,conversation_id,contact_id,title)
    VALUES(n,a1,u2,'conversation_assigned',c1,p1,'DUMMY_PRIVATE_MARKER');
  IF EXISTS(SELECT 1 FROM public.notifications WHERE id=n) THEN
    RAISE EXCEPTION 'Foreign notification recipient accepted';
  END IF;
  INSERT INTO public.notifications(id,account_id,user_id,type,conversation_id,contact_id,title)
    VALUES(n,a1,u1,'conversation_assigned',c1,p1,'DUMMY_CURRENT_MEMBER');
  IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=n) THEN
    RAISE EXCEPTION 'Current member notification incorrectly discarded';
  END IF;

  INSERT INTO public.pipelines(user_id,account_id,name) VALUES(u1,a1,'Dummy pipeline') RETURNING id INTO pipeline;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position) VALUES(pipeline,'Dummy stage',0) RETURNING id INTO v_stage;
  SELECT id INTO STRICT other_profile FROM public.profiles WHERE user_id=u2;
  INSERT INTO public.deals(user_id,account_id,pipeline_id,stage_id,contact_id,conversation_id,title,assigned_to)
    VALUES(u1,a1,pipeline,v_stage,p1,c1,'Dummy linked deal',other_profile) RETURNING id INTO deal;
  UPDATE public.conversations SET assigned_agent_id=u1 WHERE id=c1;
  UPDATE public.profiles SET account_role='agent' WHERE user_id=u1;

  -- Exercise the definer boundary with an actual authenticated role/JWT.
  PERFORM set_config('request.jwt.claim.sub',u1::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_conversation_conversion(c1,'won',100);
    RAISE EXCEPTION 'Agent changed another assignee deal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.deals WHERE id=deal AND status='won')
     OR EXISTS(SELECT 1 FROM public.conversion_events WHERE conversation_id=c1) THEN
    RAISE EXCEPTION 'Denied conversion produced a side effect';
  END IF;
  UPDATE public.deals SET assigned_to=NULL WHERE id=deal;
  SET LOCAL ROLE authenticated;
  PERFORM public.record_conversation_conversion(c1,'qualified',NULL);
  PERFORM public.record_conversation_conversion(c1,'won',100);
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM public.deals WHERE id=deal AND status='won' AND value=100)
     OR NOT EXISTS(SELECT 1 FROM public.conversion_events WHERE conversation_id=c1 AND stage='won') THEN
    RAISE EXCEPTION 'Authorized conversion failed';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',u2::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_conversation_conversion(c1,'site_visit',NULL);
    RAISE EXCEPTION 'Foreign-account conversion accepted';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.conversion_events WHERE conversation_id=c1 AND stage='site_visit') THEN
    RAISE EXCEPTION 'Foreign caller enqueued a conversion';
  END IF;
END;
$$;
ROLLBACK;
