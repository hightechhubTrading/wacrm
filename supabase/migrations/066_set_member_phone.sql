-- ============================================================
-- 066_set_member_phone.sql
--
-- Replaces set_member_waha_channel (053) as the way an admin sets a
-- teammate's `profiles.phone` (migration 052 — the agent's own number
-- the AI shares with customers who ask to talk by phone). The WAHA
-- integration is being removed (see 067), but the phone field stays.
--
-- Same SECURITY DEFINER shape as set_member_role (018) /
-- set_member_waha_channel (053): admin+ caller, target must share the
-- caller's account, self-targeting allowed.
--
-- Additive only — safe to apply BEFORE deploying the code that calls
-- it. Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_phone(
  p_user_id UUID,
  p_phone TEXT
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
  SET phone = NULLIF(TRIM(p_phone), '')
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_phone(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_phone(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_phone(UUID, TEXT) TO authenticated;
