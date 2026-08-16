-- ============================================================
-- 062_fix_next_quotation_reference_auth.sql
--
-- next_quotation_reference() (059) checks `is_account_member(p_account_id,
-- 'agent')` before minting a reference. That check resolves via
-- `auth.uid()` internally -- but getNextQuotationReference()
-- (src/lib/quotations/reference.ts) calls this RPC through
-- supabaseAdmin(), the service-role client, where auth.uid() is always
-- NULL. Every real call therefore fails with 42501 Unauthorized: every
-- quotation creation 500s against a live database, because the check
-- can never pass no matter who the caller actually is.
--
-- This is the exact bug 060_quotation_atomic_save.sql already found
-- and fixed for save_quotation_items() -- 059 shipped both functions
-- with the same auth.uid()-under-service-role mistake, but only
-- save_quotation_items() got patched. 059 is already applied live
-- (unlike 060/061, which are still pending), so it cannot be edited in
-- place; this migration replaces the function instead.
--
-- Authorization for reference minting happens one layer up, exactly as
-- 060's header describes for save_quotation_items(): the Next.js API
-- route (POST /api/quotations, via requireRole('agent') and
-- createQuotation) verifies the caller's role using the RLS-scoped
-- request-context client BEFORE ever calling getNextQuotationReference().
-- An in-function auth.uid() check here is therefore both wrong (always
-- NULL under the service-role client) and redundant (the caller was
-- already authorized). This mirrors the codebase's established
-- convention for every other admin-client-only RPC -- see
-- increment_automation_execution_count in
-- 007_automations_increment_counter.sql and save_quotation_items() in
-- 060_quotation_atomic_save.sql: no in-function auth check, REVOKE from
-- anon/authenticated, GRANT to service_role only.
--
-- Everything else about the function -- signature, sequencing logic,
-- reference format -- is unchanged from 059; only the auth.uid()-based
-- membership check is removed and the grants are tightened to
-- service_role-only (059 granted to `authenticated` too, which no
-- longer makes sense once the in-function check that gated it is gone).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION next_quotation_reference(p_account_id uuid, p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(now(), 'YY');
  v_n integer;
BEGIN
  INSERT INTO quotation_sequences (account_id, year, code, next_number)
  VALUES (p_account_id, v_year, p_code, 2)
  ON CONFLICT (account_id, year, code)
  DO UPDATE SET next_number = quotation_sequences.next_number + 1
  RETURNING next_number - 1 INTO v_n;
  RETURN 'HT-' || v_year || '-' || p_code || '-' || lpad(v_n::text, 3, '0');
END;
$$;

ALTER FUNCTION next_quotation_reference(uuid, text) OWNER TO postgres;

-- Only the service role needs to call this (reference.ts uses
-- supabaseAdmin()). Explicitly lock anon / authenticated out --
-- matches save_quotation_items()'s convention exactly.
REVOKE ALL ON FUNCTION next_quotation_reference(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION next_quotation_reference(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION next_quotation_reference(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION next_quotation_reference(uuid, text) TO service_role;
