-- ============================================================
-- 055_ai_summary_notes.sql
--
-- Lets the AI auto-reply bot mirror its rolling conversation summary
-- (conversations.ai_context_summary, migration 051) into contact_notes
-- so it's visible where an agent is actually reading -- the inbox
-- sidebar's Notes list -- and persists as a real record, not just a
-- transient banner. One row per conversation, refreshed in place
-- (never duplicated) as the summary is periodically regenerated.
--
-- is_ai_generated distinguishes these from human-authored notes so the
-- app can find-and-update the existing row instead of appending a new
-- one every refresh. conversation_id is nullable -- only set on AI
-- summary rows; a human note isn't tied to a specific conversation.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT false;

-- contact_notes.user_id is NOT NULL (references auth.users) -- an
-- AI-authored row is written under the account's config-owner user id
-- (same audit-column convention engineSendText already uses), so no
-- schema relaxation is needed there.

CREATE INDEX IF NOT EXISTS idx_contact_notes_conversation_ai
  ON contact_notes(conversation_id)
  WHERE is_ai_generated = true;
