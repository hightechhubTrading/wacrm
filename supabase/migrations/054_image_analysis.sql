-- ============================================================
-- 054_image_analysis.sql
--
-- Lets the AI assistant "see" an inbound photo instead of being blind
-- to it. A separate, optional credential -- mirroring the existing
-- embeddings_api_key/Whisper pattern -- rather than routing through
-- the account's main provider: only OpenAI and Gemini are offered
-- (Anthropic vision needs different request-building not otherwise
-- needed here, DeepSeek has no vision model; Gemini is included
-- specifically so an account can pick the cheaper tier).
--
-- messages.image_description mirrors messages.transcript (migration
-- 049) exactly -- a best-effort, opt-in description of an inbound
-- photo, feeding the same AI context a text message would.
--
-- Also bundles a pre-existing, unrelated bug fix found while touching
-- this table: ai_configs.provider's CHECK constraint was still
-- ('openai','anthropic') only from migration 029, never widened for
-- gemini/deepseek the way ai_usage_log.provider was in migration 050 --
-- silently blocking a gemini/deepseek main config from ever saving.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS image_analysis_provider TEXT,
  ADD COLUMN IF NOT EXISTS image_analysis_api_key TEXT,
  ADD COLUMN IF NOT EXISTS image_analysis_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_image_analysis_provider_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_image_analysis_provider_check
  CHECK (image_analysis_provider IS NULL OR image_analysis_provider IN ('openai', 'gemini'));

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'deepseek'));

ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_description TEXT;
