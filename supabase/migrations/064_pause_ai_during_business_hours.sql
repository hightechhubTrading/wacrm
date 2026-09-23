-- ============================================================
-- 064_pause_ai_during_business_hours.sql
--
-- Complement to after_hours_takeover_enabled (051): while that toggle
-- opts AI into replying for *assigned* conversations outside business
-- hours, this one opts AI OUT of replying to any conversation
-- (assigned or not) while the account is within its configured
-- business hours -- staff are presumably handling chats themselves
-- during that window. See src/lib/ai/auto-reply.ts.
--
-- No effect when accounts.business_hours is unconfigured (null/empty)
-- -- same "no restriction" convention isWithinBusinessHours() already
-- uses elsewhere, so flipping this on without setting hours first
-- can't silently kill all AI replies.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS pause_during_business_hours BOOLEAN NOT NULL DEFAULT false;
