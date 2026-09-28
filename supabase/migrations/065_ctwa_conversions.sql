-- ============================================================
-- 065_ctwa_conversions.sql
--
-- Click-to-WhatsApp lead quality → Meta Conversions API for Business
-- Messaging. See docs/superpowers/specs/2026-09-28-ctwa-conversions-design.md.
--
-- 1. ctwa_attributions -- one row per ad click captured by the Cloud API
--    webhook (messages[].referral). Holds ctwa_clid, a personal
--    identifier: RLS on with NO client policies -> service role only.
-- 2. conversations.ad_* -- latest ad for the conversation, denormalized
--    so the inbox can badge ad-sourced chats without touching clids.
-- 3. conversion_events -- outbox, one row per (conversation, stage).
--    event_id is unique; Meta does not dedupe business-messaging events,
--    so this row is the only double-count protection.
-- 4. enqueue_conversion() -- single write path for tags.
-- 5. deals_enqueue_won -- a deal becoming won (from ANY path: inbox,
--    pipeline board, public API) enqueues Purchase (+ QualifiedLead).
-- 6. claim_conversion_events() -- atomic claim for the sender.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ad_source_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_headline TEXT,
  ADD COLUMN IF NOT EXISTS ad_clicked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ctwa_attributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_wa_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  ctwa_clid TEXT NOT NULL,
  ad_id TEXT,
  headline TEXT,
  source_url TEXT,
  raw_referral JSONB NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ctwa_attributions_conversation_message_key UNIQUE (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ctwa_attributions_conversation_clicked
  ON ctwa_attributions (conversation_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctwa_attributions_account_clicked
  ON ctwa_attributions (account_id, clicked_at);

ALTER TABLE ctwa_attributions ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only the service role reads/writes clids.

CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  attribution_id UUID REFERENCES ctwa_attributions(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('qualified', 'site_visit', 'won')),
  meta_event_name TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  value NUMERIC(12,2),
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped_no_clid')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  meta_response JSONB,
  tagged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_due
  ON conversion_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_conversion_events_conversation
  ON conversion_events (conversation_id);

ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;
-- Read-only for members who can see the conversation (the EXISTS runs
-- under the caller's conversations RLS, so an agent only sees events on
-- conversations assigned to them -- migration 037). No write policies:
-- writes go through enqueue_conversion() / service-role routes.
DROP POLICY IF EXISTS conversion_events_select ON conversion_events;
CREATE POLICY conversion_events_select ON conversion_events FOR SELECT USING (
  is_account_member(account_id)
  AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversion_events.conversation_id)
);

CREATE OR REPLACE FUNCTION public.enqueue_conversion(
  p_conversation_id UUID,
  p_stage TEXT,
  p_value NUMERIC,
  p_currency TEXT,
  p_deal_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_attribution_id UUID;
BEGIN
  IF p_stage NOT IN ('qualified', 'site_visit', 'won') THEN
    RAISE EXCEPTION 'invalid conversion stage: %', p_stage;
  END IF;

  SELECT account_id INTO v_account_id FROM conversations WHERE id = p_conversation_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  -- Won implies Qualified (stages need not be sequential).
  IF p_stage = 'won' THEN
    PERFORM public.enqueue_conversion(p_conversation_id, 'qualified', NULL, NULL, NULL, p_user_id);
  END IF;

  SELECT id INTO v_attribution_id
  FROM ctwa_attributions
  WHERE conversation_id = p_conversation_id
  ORDER BY clicked_at DESC
  LIMIT 1;

  INSERT INTO conversion_events (
    account_id, conversation_id, attribution_id, deal_id, stage, meta_event_name,
    event_id, value, currency, status, tagged_by, tagged_at
  ) VALUES (
    v_account_id,
    p_conversation_id,
    v_attribution_id,
    p_deal_id,
    p_stage,
    CASE p_stage
      WHEN 'qualified' THEN 'QualifiedLead'
      WHEN 'site_visit' THEN 'LeadSubmitted'
      ELSE 'Purchase'
    END,
    p_conversation_id::TEXT || ':' || p_stage,
    CASE WHEN p_stage = 'won' THEN p_value END,
    CASE WHEN p_stage = 'won' THEN COALESCE(p_currency, 'QAR') END,
    CASE WHEN v_attribution_id IS NULL THEN 'skipped_no_clid' ELSE 'pending' END,
    p_user_id,
    NOW()
  )
  -- Re-tagging after an undo restores the tag; it never re-sends.
  ON CONFLICT (event_id) DO UPDATE SET undone_at = NULL;
END;
$$;

ALTER FUNCTION public.enqueue_conversion(UUID, TEXT, NUMERIC, TEXT, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_conversion(UUID, TEXT, NUMERIC, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_conversion(UUID, TEXT, NUMERIC, TEXT, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_won_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  v_conversation_id := NEW.conversation_id;
  IF v_conversation_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id
    FROM conversations
    WHERE contact_id = NEW.contact_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  IF v_conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_conversion(
    v_conversation_id, 'won', NEW.value, NEW.currency, NEW.id, auth.uid()
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to enqueue Won conversion for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_won_conversion() OWNER TO postgres;

DROP TRIGGER IF EXISTS deals_enqueue_won ON deals;
CREATE TRIGGER deals_enqueue_won
AFTER INSERT OR UPDATE OF status ON deals
FOR EACH ROW EXECUTE FUNCTION public.enqueue_won_conversion();

CREATE OR REPLACE FUNCTION public.claim_conversion_events(p_limit INTEGER)
RETURNS SETOF conversion_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A row left in 'sending' past its lease (process crashed mid-send)
  -- with no attempts left becomes 'failed' so an admin sees it.
  UPDATE conversion_events
  SET status = 'failed', last_error = COALESCE(last_error, 'Interrupted while sending')
  WHERE status = 'sending' AND next_attempt_at <= NOW() AND attempts >= 5;

  -- Claiming sets a 10-minute lease via next_attempt_at, so a crashed
  -- 'sending' row becomes claimable again once the lease expires.
  RETURN QUERY
  UPDATE conversion_events
  SET status = 'sending',
      attempts = attempts + 1,
      last_attempt_at = NOW(),
      next_attempt_at = NOW() + INTERVAL '10 minutes'
  WHERE id IN (
    SELECT id FROM conversion_events
    WHERE status IN ('pending', 'failed', 'sending')
      AND next_attempt_at <= NOW()
      AND attempts < 5
      AND undone_at IS NULL
    ORDER BY next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

ALTER FUNCTION public.claim_conversion_events(INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_conversion_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversion_events(INTEGER) TO service_role;
