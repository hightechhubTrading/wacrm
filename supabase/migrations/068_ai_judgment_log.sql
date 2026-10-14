-- Jev audit data is separate from generative provider usage. No raw messages,
-- output text, lead values, credentials or request/error bodies are stored.
CREATE TABLE IF NOT EXISTS public.ai_judgment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  trigger_message_id text,
  workflow text NOT NULL CHECK (workflow IN ('auto_reply', 'draft', 'playground')),
  question_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('shadow', 'enforce')),
  layer text NOT NULL CHECK (layer IN ('input', 'output')),
  outcome text NOT NULL CHECK (outcome IN ('allow', 'handoff', 'filtered', 'unavailable')),
  model text,
  latency_ms integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  judgments jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_judgment_log_account_created
  ON public.ai_judgment_log (account_id, created_at DESC);
ALTER TABLE public.ai_judgment_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_judgment_log_select ON public.ai_judgment_log;
CREATE POLICY ai_judgment_log_select ON public.ai_judgment_log
  FOR SELECT TO authenticated USING (public.is_account_member(account_id, 'admin'));
REVOKE ALL ON public.ai_judgment_log FROM anon, authenticated;
GRANT SELECT ON public.ai_judgment_log TO authenticated;
GRANT ALL ON public.ai_judgment_log TO service_role;
