-- ============================================================
-- 058_ai_handoff_notification.sql
--
-- Adds 'ai_handoff' to notifications.type. Today, when the AI hands a
-- conversation off to a human (auto-reply.ts, on handoff), the ONLY
-- notification an agent gets -- if a handoff_agent_id is even
-- configured -- comes from the generic on_conversation_assigned
-- trigger (027), whose text is "Someone assigned you a conversation
-- with X". Since the AI runs under the service-role client
-- (auth.uid() IS NULL), that generic wording gives the agent zero
-- signal that this was an AI handoff (vs. a teammate reassigning it),
-- and zero context on why -- the actual handoff summary
-- (conversations.ai_handoff_summary) is computed but never surfaced
-- in the notification itself. Worse, if no handoff_agent_id is
-- configured at all, NOBODY is notified -- the conversation just sits
-- with ai_autoreply_disabled = true until someone happens to notice
-- it in the inbox.
--
-- This migration only widens the CHECK constraint (same pattern as
-- 048/051 adding ai_key_invalid/urgent_lead) so the app can insert a
-- clearly-labeled, own notification row at the handoff point --
-- explicit sender (notifyAiHandoff in src/lib/ai/handoff.ts), not
-- inferred from a generic trigger, and always addressed to the
-- assigned agent or, with none configured, every admin/owner (same
-- fallback notifyUrgentLead already uses).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_key_invalid', 'urgent_lead', 'ai_handoff'));
