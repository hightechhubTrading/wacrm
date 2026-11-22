-- Additive notification-center upgrade. Apply before enabling new producers.
BEGIN;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK
  (type IN ('conversation_assigned','ai_key_invalid','urgent_lead','ai_handoff',
    'followup_due','reply_review_required','media_review_required'));
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_cursor
  ON public.notifications(account_id,user_id,created_at DESC,id DESC);

-- A server timestamp and one database statement define the mark-all boundary.
-- SECURITY INVOKER preserves recipient RLS and the read_at-only column grant.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_account uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE cutoff timestamptz := statement_timestamp();
BEGIN
  UPDATE public.notifications n SET read_at=cutoff
  WHERE n.user_id=auth.uid() AND n.account_id=p_account AND public.is_account_member(p_account)
    AND n.read_at IS NULL AND n.created_at<=cutoff;
  RETURN cutoff;
END $$;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid) TO authenticated;
-- Historical notification text follows current conversation visibility too.
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
USING (user_id=auth.uid() AND public.is_account_member(account_id)
  AND (conversation_id IS NULL OR EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id=notifications.conversation_id
      AND c.account_id=notifications.account_id)));
-- Read-only preflight: never marks real records read during deployment checks.
CREATE FUNCTION public.notification_center_ready() RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce(
   has_function_privilege('authenticated','public.mark_notifications_read(uuid)','EXECUTE')
   AND NOT has_function_privilege('anon','public.mark_notifications_read(uuid)','EXECUTE')
   AND NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.mark_notifications_read(uuid)'::regprocedure)
   AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass
     AND conname='notifications_type_check'
     AND pg_get_constraintdef(oid) LIKE '%followup_due%'
     AND pg_get_constraintdef(oid) LIKE '%reply_review_required%'
     AND pg_get_constraintdef(oid) LIKE '%media_review_required%')
   AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications'
     AND policyname='notifications_select' AND qual LIKE '%conversation_id%'),false);
$$;
REVOKE ALL ON FUNCTION public.notification_center_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_center_ready() TO service_role;
COMMIT;
