-- ============================================================
-- 049_voice_transcription.sql
--
-- Inbound WhatsApp voice notes previously rendered as a bare <audio>
-- player with zero AI processing — a customer who voice-messages got
-- no benefit from drafts, auto-reply, or field-collection at all.
-- Adds an opt-in transcription step (OpenAI Whisper, reusing the
-- existing embeddings_api_key — already a standalone, always-OpenAI
-- credential independent of the account's main chat provider) so
-- transcribed text can feed the same AI context window as a text
-- message.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS transcript TEXT;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS transcribe_voice_messages BOOLEAN NOT NULL DEFAULT false;
