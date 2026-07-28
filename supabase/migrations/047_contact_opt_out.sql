-- ============================================================
-- 047_contact_opt_out.sql
--
-- WhatsApp opt-out / STOP-keyword compliance. Adds the fields needed to
-- record that a contact asked to stop receiving messages, and a new
-- 'skipped' broadcast_recipients status so a broadcast can honor that
-- without pretending the send failed.
--
-- opted_out_source distinguishes an inbound STOP/UNSUBSCRIBE/CANCEL/
-- END/QUIT keyword match (see src/lib/whatsapp/opt-out.ts) from a
-- manual admin toggle in the contact panel (e.g. a customer calls in
-- and asks to be removed, or a keyword false-positive needs reversing).
--
-- Scope is deliberately narrow: opted_out only gates AUTOMATED sends
-- (broadcasts, automations, flows). Manual 1:1 replies from the inbox
-- are never blocked by this column — see the app-layer gates in
-- broadcast-core.ts, the dashboard broadcast route, automations/
-- meta-send.ts, and flows/meta-send.ts. No new RLS policy is needed
-- here: contacts is already account-scoped RLS from 017_account_
-- sharing.sql, and that coverage extends automatically to new columns.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS opted_out_source text
    CHECK (opted_out_source IN ('keyword', 'manual'));

-- Partial index — the broadcast composer needs a cheap "how many of
-- these selected recipients have opted out" count per account.
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts(account_id) WHERE opted_out;

-- Extend the broadcast_recipients status set with 'skipped', for
-- recipients who were never sent to because they'd opted out.
ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped'));

-- Give 'skipped' its own aggregate column on broadcasts, and teach the
-- incremental trigger (005_broadcast_counts_incremental.sql) and its
-- recompute-from-scratch safety net about it — otherwise a skipped
-- recipient would silently vanish from total_recipients minus the
-- other counts instead of being accounted for.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  -- 'pending' contributes to nothing.
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  IF s = 'skipped'   THEN RETURN ARRAY['skipped_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    skipped_count   = agg.skipped_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count,
      COUNT(*) FILTER (WHERE status = 'skipped')                              AS skipped_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
