-- ============================================================
-- 048_ai_key_error_tracking.sql
--
-- Surfaces AI provider key failures instead of letting them fail
-- silently. Previously an invalid/expired BYO key just logged to the
-- server console from src/lib/ai/auto-reply.ts — an account's auto-
-- reply bot could be dead for days with zero user-facing signal.
--
-- last_key_error / last_key_error_at mirror the exact pattern
-- whatsapp_config already uses for registered_at/last_registration_error
-- (015_whatsapp_config_registration.sql): set on a real auth failure
-- (AiError.code === 'invalid_key'), cleared on the next successful call
-- or a successful "Test key".
--
-- notifications.type gets a new value, 'ai_key_invalid', so admin+
-- members are notified once per failure episode (not once per inbound
-- message while the key stays broken).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS last_key_error TEXT,
  ADD COLUMN IF NOT EXISTS last_key_error_at TIMESTAMPTZ;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_key_invalid'));
