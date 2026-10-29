BEGIN;
-- A generated research question is always draft work, never an approved product fact.
ALTER TABLE public.ai_catalog_questions ADD COLUMN gap_key text;
ALTER TABLE public.ai_catalog_questions ADD CONSTRAINT ai_catalog_question_gap_unique UNIQUE(account_id,gap_key);
-- Keep the send audit when an asset is deleted; the immutable snapshot ID remains.
ALTER TABLE public.ai_media_actions ADD COLUMN file_snapshot_id uuid;
UPDATE public.ai_media_actions SET file_snapshot_id=file_id;
ALTER TABLE public.ai_media_actions ALTER COLUMN file_snapshot_id SET NOT NULL;
DO $$ DECLARE key_name text; BEGIN
 SELECT conname INTO key_name FROM pg_constraint WHERE conrelid='public.ai_media_actions'::regclass AND contype='u' AND pg_get_constraintdef(oid) LIKE 'UNIQUE (account_id, conversation_id, trigger_message_id, file_id)%';
 IF key_name IS NULL THEN RAISE EXCEPTION 'Expected media action key is missing'; END IF;
 EXECUTE format('ALTER TABLE public.ai_media_actions DROP CONSTRAINT %I',key_name);
END $$;
ALTER TABLE public.ai_media_actions DROP CONSTRAINT ai_media_actions_file_id_fkey;
ALTER TABLE public.ai_media_actions ALTER COLUMN file_id DROP NOT NULL;
ALTER TABLE public.ai_media_actions ADD FOREIGN KEY(file_id) REFERENCES public.ai_product_media(id) ON DELETE SET NULL;
ALTER TABLE public.ai_media_actions ADD CONSTRAINT ai_media_action_once UNIQUE(account_id,conversation_id,trigger_message_id,file_snapshot_id);
CREATE OR REPLACE FUNCTION public.validate_ai_media_action() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.trigger_message_id IS DISTINCT FROM OLD.trigger_message_id OR NEW.file_snapshot_id IS DISTINCT FROM OLD.file_snapshot_id) THEN
  RAISE EXCEPTION 'Media action identity cannot change' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=NEW.conversation_id AND account_id=NEW.account_id) OR
    NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=NEW.conversation_id AND sender_type='customer' AND message_id=NEW.trigger_message_id) OR
    (NEW.file_id IS NOT NULL AND (NEW.file_id<>NEW.file_snapshot_id OR NOT EXISTS(SELECT 1 FROM public.ai_product_media WHERE id=NEW.file_id AND account_id=NEW.account_id))) OR
    (TG_OP='INSERT' AND NEW.file_id IS NULL) THEN
  RAISE EXCEPTION 'Invalid media action relationship' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
COMMIT;
