-- Short-lived collaboration hints. This is advisory activity, not a send lock.
CREATE TABLE public.conversation_activity (
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tab_id uuid NOT NULL,
 sequence bigint NOT NULL,
 active boolean NOT NULL DEFAULT true,
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 composing_until timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id,user_id,tab_id)
);
CREATE INDEX conversation_activity_expiry ON public.conversation_activity(account_id,last_seen_at);
ALTER TABLE public.conversation_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_activity FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.conversation_activity TO authenticated,service_role;
CREATE POLICY conversation_activity_read ON public.conversation_activity FOR SELECT TO authenticated USING(
 is_account_member(account_id,'agent') AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id AND c.account_id=conversation_activity.account_id)
);
CREATE FUNCTION public.conversation_activity_snapshot(p_conversation uuid,p_tab uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH allowed AS (
  SELECT c.* FROM conversations c WHERE c.id=p_conversation AND
   (is_account_member(c.account_id,'admin') OR (is_account_member(c.account_id,'agent') AND c.assigned_agent_id=auth.uid()))
 ) SELECT jsonb_build_object('serverNow',now(),'peers',coalesce((
  SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'tabId',a.tab_id,'name',p.full_name,
    'expiresAt',a.last_seen_at+interval '45 seconds','composingUntil',a.composing_until))
  FROM conversation_activity a JOIN allowed c ON c.id=a.conversation_id AND c.account_id=a.account_id
  JOIN profiles p ON p.user_id=a.user_id AND p.account_id=a.account_id
  WHERE a.active AND a.last_seen_at>now()-interval '45 seconds'
   AND (a.user_id<>auth.uid() OR a.tab_id<>p_tab)
   AND (p.account_role IN ('owner','admin') OR (p.account_role='agent' AND c.assigned_agent_id=a.user_id))
 ),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.conversation_activity_snapshot(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conversation_activity_snapshot(uuid,uuid) TO authenticated,service_role;
CREATE FUNCTION public.record_conversation_activity(p_conversation uuid,p_tab uuid,p_sequence bigint,p_composing boolean DEFAULT false,p_leave boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.conversations%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation;
 IF c.id IS NULL OR NOT (is_account_member(c.account_id,'admin') OR (is_account_member(c.account_id,'agent') AND c.assigned_agent_id=auth.uid()))
 THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
 IF p_tab IS NULL OR p_sequence IS NULL OR p_sequence<1 OR p_sequence>9007199254740991 THEN RAISE EXCEPTION 'Invalid activity request' USING ERRCODE='22023'; END IF;
 INSERT INTO public.conversation_activity(conversation_id,account_id,user_id,tab_id,sequence,active,last_seen_at,composing_until)
 VALUES(c.id,c.account_id,auth.uid(),p_tab,p_sequence,NOT coalesce(p_leave,false),now(),
  CASE WHEN p_composing AND NOT coalesce(p_leave,false) THEN now()+interval '15 seconds' ELSE now() END)
 ON CONFLICT(conversation_id,user_id,tab_id) DO UPDATE SET sequence=excluded.sequence,active=excluded.active,
  last_seen_at=excluded.last_seen_at,composing_until=excluded.composing_until
 WHERE conversation_activity.sequence<excluded.sequence;
 -- Bounded cleanup; a leave is a tombstone so late heartbeats cannot resurrect it.
 DELETE FROM public.conversation_activity a WHERE (a.conversation_id,a.user_id,a.tab_id) IN (
  SELECT stale.conversation_id,stale.user_id,stale.tab_id FROM public.conversation_activity stale
  WHERE stale.account_id=c.account_id AND stale.last_seen_at<now()-interval '1 day' LIMIT 100
 );
 RETURN public.conversation_activity_snapshot(c.id,p_tab);
END;$$;
REVOKE ALL ON FUNCTION public.record_conversation_activity(uuid,uuid,bigint,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_conversation_activity(uuid,uuid,bigint,boolean,boolean) TO authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='conversation_activity')
 THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_activity; END IF;
END;$$;
