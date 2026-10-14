-- Additive; deploy before enabling the follow-up UI. No ownership/reset backfill.
CREATE TABLE IF NOT EXISTS public.ai_reply_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  trigger_message_id text,
  outcome text NOT NULL CHECK (outcome IN ('skipped', 'sent', 'handoff', 'failed')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reply_events_thread ON public.ai_reply_events(conversation_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.ai_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  source_message_id text,
  kind text NOT NULL CHECK (kind IN ('handoff','quotation','inspection','repair','location','comparison','document_review')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','deferred','completed','cancelled')),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz,
  confirmed_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  next_reminder_at timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  completion_evidence text,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'completed' OR (length(trim(completion_evidence)) >= 10 AND completed_by IS NOT NULL)),
  CHECK (status <> 'deferred' OR due_at > updated_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_followups_active_kind ON public.ai_followups(conversation_id,kind)
  WHERE status IN ('open','acknowledged','deferred');
CREATE INDEX IF NOT EXISTS ai_followups_due ON public.ai_followups(next_reminder_at)
  WHERE status IN ('open','acknowledged','deferred');
-- Enforce tenant relationships for both server and future callers.
CREATE OR REPLACE FUNCTION public.validate_ai_work_tenant() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = NEW.conversation_id AND c.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Invalid conversation account';
  END IF;
  IF TG_TABLE_NAME = 'ai_followups' THEN
    IF NEW.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.owner_id AND p.account_id = NEW.account_id AND p.account_role IN ('agent','admin','owner')) THEN
      RAISE EXCEPTION 'Invalid follow-up owner';
    END IF;
    IF NEW.completed_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.completed_by AND p.account_id = NEW.account_id AND p.account_role IN ('agent','admin','owner')) THEN
      RAISE EXCEPTION 'Invalid completion author';
    END IF;
    IF NEW.source_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = NEW.conversation_id AND m.message_id = NEW.source_message_id AND m.sender_type = 'customer') THEN
      RAISE EXCEPTION 'Invalid follow-up source';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_ai_reply_event ON public.ai_reply_events;
CREATE TRIGGER validate_ai_reply_event BEFORE INSERT OR UPDATE ON public.ai_reply_events FOR EACH ROW EXECUTE FUNCTION public.validate_ai_work_tenant();
DROP TRIGGER IF EXISTS validate_ai_followup ON public.ai_followups;
CREATE TRIGGER validate_ai_followup BEFORE INSERT OR UPDATE ON public.ai_followups FOR EACH ROW EXECUTE FUNCTION public.validate_ai_work_tenant();
ALTER TABLE public.ai_reply_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_reply_events_visible ON public.ai_reply_events;
CREATE POLICY ai_reply_events_visible ON public.ai_reply_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = ai_reply_events.account_id)
);
DROP POLICY IF EXISTS ai_followups_visible ON public.ai_followups;
CREATE POLICY ai_followups_visible ON public.ai_followups FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = ai_followups.account_id)
);
REVOKE ALL ON public.ai_reply_events, public.ai_followups FROM anon, authenticated;
GRANT SELECT ON public.ai_reply_events, public.ai_followups TO authenticated;
GRANT ALL ON public.ai_reply_events, public.ai_followups TO service_role;
-- Partial-index conflict inference gives a single durable task under retries.
CREATE OR REPLACE FUNCTION public.ensure_ai_followup(p_account_id uuid, p_conversation_id uuid, p_source_message_id text, p_kind text, p_owner_id uuid)
RETURNS uuid LANGUAGE sql SET search_path = public AS $$
  INSERT INTO public.ai_followups(account_id,conversation_id,source_message_id,kind,owner_id)
  VALUES(p_account_id,p_conversation_id,p_source_message_id,p_kind,p_owner_id)
  ON CONFLICT(conversation_id,kind) WHERE status IN ('open','acknowledged','deferred')
  DO UPDATE SET source_message_id = ai_followups.source_message_id
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.ensure_ai_followup(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_ai_followup(uuid,uuid,text,text,uuid) TO service_role;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS document_text text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS document_status text
  CHECK (document_status IN ('received','parsed','partial','unsupported','failed'));
