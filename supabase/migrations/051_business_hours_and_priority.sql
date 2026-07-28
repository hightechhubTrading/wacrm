-- ============================================================
-- 051_business_hours_and_priority.sql
--
-- Two related AI-capability additions bundled in one small migration:
--
-- 1. Business hours + after-hours AI takeover. No business-hours
--    concept existed anywhere before this (confirmed — no timezone/
--    schedule field on accounts). accounts.business_hours is a JSONB
--    map, one key per weekday ('mon'..'sun'), each either null
--    (closed) or ["HH:mm","HH:mm"] (open/close) — null overall means
--    "unconfigured", i.e. always available, no restriction.
--    ai_configs.after_hours_takeover_enabled opts an account into AI
--    replying even when a human is assigned, outside those hours (see
--    src/lib/ai/auto-reply.ts). conversations.ai_context_summary(_at)
--    cache a short AI-generated recap so a long-running thread still
--    has continuity beyond the normal message window, and so a
--    returning agent can catch up on what AI handled overnight.
--
-- 2. AI-set lead priority. conversations.ai_priority/ai_priority_reason
--    are set via a sentinel the model emits on the same auto-reply/
--    after-hours call it already makes (see parseGeneration in
--    src/lib/ai/generate.ts) — no extra LLM call. notifications.type
--    gets 'urgent_lead' alongside 'ai_key_invalid' (048).
--
-- RLS: no change needed for accounts (existing admin+-gated
-- accounts_update from 017) or conversations (existing policies
-- already cover new columns on that table).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_hours JSONB,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS after_hours_takeover_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_context_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_context_summary_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_priority TEXT
    CHECK (ai_priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS ai_priority_reason TEXT;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_key_invalid', 'urgent_lead'));
