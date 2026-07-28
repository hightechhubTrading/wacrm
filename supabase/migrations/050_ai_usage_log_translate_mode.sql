-- ============================================================
-- 050_ai_usage_log_translate_mode.sql
--
-- Adds 'translate' to ai_usage_log.mode for the new on-demand message
-- translation feature (src/app/api/ai/translate).
--
-- While touching this constraint: ai_usage_log.provider was still
-- CHECK'd to ('openai', 'anthropic') from migration 033, predating the
-- Gemini/DeepSeek providers added later (src/lib/ai/types.ts's
-- AiProvider union has included all four for a while) — usage logging
-- for those two providers has been silently failing the CHECK ever
-- since (logAiUsage swallows the error, so no reply ever broke, but no
-- spend was recorded either). Fixed in the same migration since it's
-- the same constraint mechanism.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'translate'));

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'deepseek'));
