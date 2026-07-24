-- ============================================================
-- 039_ai_reply_cap_and_product_tags.sql -- remove the auto-reply cap
-- ceiling + link media-library items to a contact tag.
--
-- Two independent, small changes:
--
-- 1. auto_reply_max_per_conversation was hard-capped at 1-20 (029).
--    Businesses want to let the bot keep answering as long as the
--    customer keeps replying, so the cap becomes opt-in: 0 means
--    unlimited, any positive integer is still a hard cap.
--    claim_ai_reply_slot is updated to treat 0 (or less) as "no cap".
--    Existing configs are reset to unlimited (0), since the old
--    default (3) was the reason the bot was going quiet mid-
--    conversation.
--
-- 2. ai_media_library gets a nullable tag_id -- resolved (find-or-
--    create) at item-save time in the settings UI (never at
--    reply-time, which runs under the service-role client with no
--    human user to attribute a new tag to). The auto-reply bot can
--    then apply this tag to a contact whenever the model flags that
--    product as the topic of conversation (see PRODUCT_TAG_SENTINEL_*
--    in lib/ai/defaults.ts), independent of attaching a file.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ---- 1. Uncap auto_reply_max_per_conversation ----------------

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation >= 0);

-- Reset existing accounts to unlimited -- the low default (3) was the
-- reported bug ("bot stops replying"), and the cap is now opt-in.
UPDATE ai_configs SET auto_reply_max_per_conversation = 0;

CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
WITH claimed AS (
  UPDATE conversations
  SET ai_reply_count = ai_reply_count + 1
  WHERE id = conversation_id
    AND (max_replies <= 0 OR ai_reply_count < max_replies)
  RETURNING 1
)
SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;

-- ---- 2. Link media-library items to a contact tag -------------

ALTER TABLE ai_media_library
  ADD COLUMN IF NOT EXISTS tag_id uuid REFERENCES tags(id) ON DELETE SET NULL;
