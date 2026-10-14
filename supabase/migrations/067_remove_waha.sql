-- ============================================================
-- 067_remove_waha.sql
--
-- Removes the WAHA (WhatsApp HTTP API) integration: stage-enter group
-- notifications (043/045) and per-agent conversation channels (053).
-- Connecting agents' personal numbers through WAHA caused problems for
-- those WhatsApp accounts, so the feature is gone from the app.
--
-- Kept on purpose:
--   - `profiles.phone` (052) — still used by the AI and editable via
--     set_member_phone (066).
--   - `messages.channel` (053) — historical rows tagged 'waha' record
--     which messages went out over an agent's personal number. New
--     rows take the 'meta' default.
--
-- DESTRUCTIVE: apply only AFTER the code without WAHA is deployed —
-- the previous build still reads these columns/tables.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DROP FUNCTION IF EXISTS public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_member_waha_session(UUID, TEXT);

DROP TABLE IF EXISTS waha_config;

ALTER TABLE profiles DROP COLUMN IF EXISTS waha_session_name;
ALTER TABLE profiles DROP COLUMN IF EXISTS waha_webhook_secret;

ALTER TABLE pipeline_stages DROP COLUMN IF EXISTS notify_group_on_enter;
