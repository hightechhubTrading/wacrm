-- ============================================================
-- 053_agent_waha_conversation_channels.sql
--
-- Extends the existing per-agent WAHA infrastructure (migration 045's
-- profiles.waha_session_name, migration 052's profiles.phone) so a
-- conversation assigned to an agent with BOTH fields set can route
-- through that agent's own WhatsApp number for real 1:1 customer
-- conversations, not just deal-notification posts.
--
-- No new table — see docs/superpowers/specs/2026-07-29-agent-waha-
-- channels-design.md for why. Only new storage: an encrypted webhook
-- secret per agent, and a channel tag on messages.
--
-- set_member_waha_channel replaces set_member_waha_session: same
-- SECURITY DEFINER shape (admin+ caller, target must share the
-- caller's account, self-targeting allowed), but sets session_name +
-- phone + webhook_secret in one call so the admin UI can save both
-- fields together. The old RPC is dropped; nothing else calls it
-- (grep confirmed only 045's own definition and the members PATCH
-- route referenced it, and the route is updated in this same change).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS waha_webhook_secret TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'meta'
  CHECK (channel IN ('meta', 'waha'));

DROP FUNCTION IF EXISTS public.set_member_waha_session(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.set_member_waha_channel(
  p_user_id UUID,
  p_session_name TEXT,
  p_phone TEXT,
  p_new_webhook_secret TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_session TEXT := NULLIF(TRIM(p_session_name), '');
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Target must be in the caller's account.
  SELECT account_id INTO v_target_account_id
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id IS DISTINCT FROM v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET waha_session_name = v_session,
      phone = NULLIF(TRIM(p_phone), ''),
      -- Clearing the session invalidates any existing webhook secret
      -- immediately, so a disconnected agent's old webhook URL stops
      -- authenticating. A fresh secret (passed by the caller, which
      -- generates it in Node — see the PATCH route) is only stored
      -- when explicitly provided; otherwise the existing secret is
      -- left untouched so re-saving the phone number alone doesn't
      -- invalidate an already-working webhook.
      waha_webhook_secret = CASE
        WHEN v_session IS NULL THEN NULL
        WHEN p_new_webhook_secret IS NOT NULL THEN p_new_webhook_secret
        ELSE waha_webhook_secret
      END
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT) TO authenticated;
