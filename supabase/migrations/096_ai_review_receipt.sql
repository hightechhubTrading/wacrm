-- Additive. No message replay or configuration changes. Service-role-only receipt claim.
CREATE OR REPLACE FUNCTION public.claim_ai_review_receipt(
  p_account_id uuid, p_conversation_id uuid, p_trigger_message_id text,
  p_expected_assignee uuid, p_max_replies integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.conversations%ROWTYPE; latest_id text; latest_sender text;
BEGIN
  SELECT * INTO c FROM public.conversations
    WHERE id = p_conversation_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND OR c.ai_autoreply_disabled
     OR c.assigned_agent_id IS DISTINCT FROM p_expected_assignee
     OR p_trigger_message_id IS NULL OR p_max_replies IS NULL
     OR (p_max_replies > 0 AND COALESCE(c.ai_reply_count, 0) >= p_max_replies)
  THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_configs WHERE account_id = p_account_id AND is_active AND auto_reply_enabled) THEN RETURN false; END IF;
  SELECT message_id, sender_type INTO latest_id, latest_sender FROM public.messages
    WHERE conversation_id = p_conversation_id
    ORDER BY created_at DESC, received_at DESC NULLS LAST, id DESC LIMIT 1;
  IF latest_sender IS DISTINCT FROM 'customer' OR latest_id IS DISTINCT FROM p_trigger_message_id THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_reply_events
    WHERE conversation_id = p_conversation_id AND reason = 'review_receipt_claimed'
      AND (trigger_message_id = p_trigger_message_id OR created_at > now() - interval '1 hour'))
  THEN RETURN false; END IF;
  INSERT INTO public.ai_reply_events(account_id, conversation_id, trigger_message_id, outcome, reason)
    VALUES (p_account_id, p_conversation_id, p_trigger_message_id, 'skipped', 'review_receipt_claimed');
  UPDATE public.conversations SET ai_reply_count = COALESCE(ai_reply_count, 0) + 1 WHERE id = p_conversation_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_ai_review_receipt(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_review_receipt(uuid,uuid,text,uuid,integer) TO service_role;
