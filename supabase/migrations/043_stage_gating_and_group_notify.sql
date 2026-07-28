-- ============================================================
-- 043_stage_gating_and_group_notify.sql
--
-- Two independent additions in support of pipeline stage automation:
--
-- 1. `stage_exit_requirements` — lets an admin mark which of the
--    account's contact `custom_fields` must have a non-empty value
--    before a deal is allowed to leave a given stage. Reuses the same
--    field values the AI bot already collects via `[[SET_FIELD:...]]`
--    (see collect-fields.ts) and that a human agent can edit today on
--    the contact detail view — no new value-entry surface needed,
--    only a new "which fields are required here" configuration.
--    Enforced in the new `POST /api/pipelines/deals/[id]/move` route,
--    not by a DB trigger — the route needs to return which specific
--    fields are missing, which is awkward to surface from a trigger
--    exception message alone.
--
-- 2. `pipeline_stages.notify_group_on_enter` + `waha_config` — lets a
--    deal entering a flagged stage (e.g. "Site Visit") fire a
--    structured WhatsApp message into an internal ops GROUP chat.
--    Meta's Cloud API (the only WhatsApp connection this app has) has
--    no concept of group messaging at all, so this rides on a
--    separate, self-hosted WAHA (WhatsApp HTTP API) instance the
--    account admin stands up and authenticates independently — see
--    src/lib/notifications/waha-client.ts. `waha_config` follows the
--    exact shape/RLS of `ai_configs` (029): one row per account, the
--    API key AES-256-GCM-encrypted, admin+ write.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ---- 1. Stage-exit field requirements --------------------------

CREATE TABLE IF NOT EXISTS stage_exit_requirements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id        uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  custom_field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, custom_field_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_exit_requirements_stage
  ON stage_exit_requirements(stage_id);

ALTER TABLE stage_exit_requirements ENABLE ROW LEVEL SECURITY;

-- Same shape as pipeline_stages_select/modify (017): any account
-- member may read which fields are required; only admin+ configure it.
DROP POLICY IF EXISTS stage_exit_requirements_select ON stage_exit_requirements;
CREATE POLICY stage_exit_requirements_select ON stage_exit_requirements FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = stage_exit_requirements.stage_id
      AND is_account_member(p.account_id)
  )
);

DROP POLICY IF EXISTS stage_exit_requirements_modify ON stage_exit_requirements;
CREATE POLICY stage_exit_requirements_modify ON stage_exit_requirements FOR ALL USING (
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = stage_exit_requirements.stage_id
      AND is_account_member(p.account_id, 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = stage_exit_requirements.stage_id
      AND is_account_member(p.account_id, 'admin')
  )
);

-- ---- 2. Stage-entry group notification -------------------------

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS notify_group_on_enter boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS waha_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  base_url        text,                     -- e.g. https://waha.example.com
  api_key         text,                     -- AES-256-GCM-encrypted (X-Api-Key)
  session_name    text NOT NULL DEFAULT 'default',
  group_chat_id   text,                     -- e.g. "1203..@g.us"
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE waha_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waha_config_select ON waha_config;
CREATE POLICY waha_config_select ON waha_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS waha_config_insert ON waha_config;
CREATE POLICY waha_config_insert ON waha_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS waha_config_update ON waha_config;
CREATE POLICY waha_config_update ON waha_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS waha_config_delete ON waha_config;
CREATE POLICY waha_config_delete ON waha_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_waha_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS waha_config_updated_at ON waha_config;
CREATE TRIGGER waha_config_updated_at
  BEFORE UPDATE ON waha_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_waha_config_updated_at();
