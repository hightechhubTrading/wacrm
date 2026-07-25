-- ============================================================
-- 041_lead_auto_creation_and_ai_fields.sql
--
-- Two independent additions in support of the auto-reply bot's new
-- lead-capture behaviour:
--
-- 1. custom_fields.ai_collectible -- an opt-in flag marking which of
--    the account's custom fields the AI auto-reply bot is allowed to
--    see and populate from the conversation. Keeps the bot from being
--    handed every custom field on the account (some may be unrelated
--    or sensitive) -- only fields explicitly opted in are ever listed
--    in its system prompt or written to (see collect-fields.ts).
--
-- 2. Auto-create a "new lead" deal the moment a brand-new conversation
--    row is inserted -- regardless of which code path created it
--    (inbound webhook, public API send, dashboard composer, etc.) --
--    so every new conversation shows up on the pipeline board without
--    relying on a human to remember to add it. Uses the account's
--    oldest pipeline and that pipeline's lowest-position stage; an
--    account with no pipeline yet is skipped silently (nothing to
--    file the lead under).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS ai_collectible BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.create_lead_deal_for_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  v_stage_id UUID;
  v_title TEXT;
  v_currency TEXT;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = NEW.account_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_stage_id
  FROM pipeline_stages
  WHERE pipeline_id = v_pipeline_id
  ORDER BY position ASC
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), NULLIF(phone, ''), 'New lead') INTO v_title
  FROM contacts
  WHERE id = NEW.contact_id;

  SELECT default_currency INTO v_currency
  FROM accounts
  WHERE id = NEW.account_id;

  INSERT INTO deals (
    account_id, user_id, pipeline_id, stage_id, contact_id, conversation_id, title, currency
  ) VALUES (
    NEW.account_id, NEW.user_id, v_pipeline_id, v_stage_id, NEW.contact_id, NEW.id,
    COALESCE(v_title, 'New lead'), COALESCE(v_currency, 'USD')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to auto-create lead deal for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.create_lead_deal_for_conversation() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_created_make_deal ON conversations;
CREATE TRIGGER on_conversation_created_make_deal
AFTER INSERT ON conversations
FOR EACH ROW EXECUTE FUNCTION public.create_lead_deal_for_conversation();
