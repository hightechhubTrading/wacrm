-- ============================================================
-- 045_per_agent_waha_sessions.sql
--
-- Lets each team member have their OWN WAHA (WhatsApp HTTP API)
-- session — their own WhatsApp number logged into the same shared
-- WAHA instance (`waha_config.base_url`/`api_key` stay account-level;
-- only which logged-in number to send FROM varies per member). The
-- stage-enter group notification (migration 043) then sends from the
-- deal's ASSIGNED agent's own number instead of one shared "default",
-- so whoever picks up the site-visit request in the group knows
-- which agent to report back to.
--
-- `waha_session_name` is added directly to `profiles`, mirroring the
-- existing precedent of `theme`/`mode` (migration 042) — there is no
-- dedicated per-member settings table anywhere in this codebase, and
-- one column doesn't justify inventing that pattern.
--
-- `profiles`' base RLS (migration 017) is self-only update, and the
-- `enforce_profile_privilege_columns` trigger (034) only guards
-- `account_role`/`account_id` — neither lets an admin set a
-- DIFFERENT member's `waha_session_name` through the normal client.
-- `set_member_waha_session` mirrors `set_member_role` (018) exactly
-- for this reason: SECURITY DEFINER so it can write across profile
-- rows, with the real admin+/same-account authorization done inside
-- the function body.
--
-- Unlike `set_member_role`, self-targeting is NOT blocked — an
-- admin/owner who is also a working sales agent should be able to
-- set their own session through the same roster-managed path.
--
-- IMPORTANT: `deals.assigned_to` is a FK to `profiles.id` (the PK,
-- migration 002), while this RPC (like `set_member_role`) keys off
-- `profiles.user_id` (auth.users.id). Callers resolving "the assigned
-- agent's session" from a deal must look up `profiles` by
-- `id = assigned_to`, NOT `user_id` — see src/lib/pipelines/notify.ts.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS waha_session_name text;

CREATE OR REPLACE FUNCTION public.set_member_waha_session(
  p_user_id UUID,
  p_session_name TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
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
  SET waha_session_name = NULLIF(TRIM(p_session_name), '')
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_waha_session(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_waha_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_waha_session(UUID, TEXT) TO authenticated;
