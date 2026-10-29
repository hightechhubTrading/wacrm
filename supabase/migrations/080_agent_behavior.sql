-- Explicit facts and account-scoped behavior rollout. Existing accounts keep their current policy.
BEGIN;
ALTER TABLE public.ai_configs
 ADD COLUMN company_facts text CHECK(company_facts IS NULL OR length(company_facts)<=12000),
 ADD COLUMN behavior_v2_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_reply_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE public.ai_media_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 trigger_message_id text NOT NULL,
 file_id uuid NOT NULL REFERENCES public.ai_product_media(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','uncertain')),
 provider_message_id text,
 failure_code text,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,conversation_id,trigger_message_id,file_id)
);
CREATE FUNCTION public.validate_ai_media_action() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=NEW.conversation_id AND account_id=NEW.account_id) OR
    NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=NEW.conversation_id AND sender_type='customer' AND message_id=NEW.trigger_message_id) OR
    NOT EXISTS(SELECT 1 FROM public.ai_product_media WHERE id=NEW.file_id AND account_id=NEW.account_id) THEN
  RAISE EXCEPTION 'Invalid media action relationship' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER validate_ai_media_action BEFORE INSERT OR UPDATE ON public.ai_media_actions FOR EACH ROW EXECUTE FUNCTION public.validate_ai_media_action();
ALTER TABLE public.ai_media_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_media_action_read ON public.ai_media_actions FOR SELECT TO authenticated USING(public.is_account_member(account_id));
REVOKE ALL ON public.ai_media_actions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_media_actions TO authenticated;
GRANT ALL ON public.ai_media_actions TO service_role;
REVOKE ALL ON FUNCTION public.validate_ai_media_action() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ai_media_action() TO service_role;
COMMIT;
