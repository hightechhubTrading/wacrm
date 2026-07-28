-- ============================================================
-- 046_custom_field_groups.sql
--
-- Generalizes the ad-hoc "Site Visit Info" feature (migration 044:
-- deals.order_location/order_product/order_visit_time/order_note +
-- pipeline_stages.requires_order_info) and the never-used generic
-- per-field stage gate (migration 043: stage_exit_requirements) into
-- one real system: custom field GROUPS.
--
-- A group has a name, a SCOPE ('contact' — persists across a
-- contact's whole history, e.g. preferences; or 'deal' — belongs to
-- one specific order, so a repeat customer's second order never
-- collides with the first, the same reason 044's fields were
-- deal-scoped in the first place), and an `is_active` toggle
-- controlling whether its fields show in the contact side panel at
-- all. Fields within a group inherit its scope, get an actual
-- `field_type` (finally used — see below), and a `required` flag. An
-- owner can link a group to a pipeline stage so that stage can't be
-- left until the group's required fields are filled
-- (`stage_required_groups` — replaces both `stage_exit_requirements`
-- and `requires_order_info` as the one mechanism going forward).
--
-- `field_type`/`field_options` on `custom_fields` have been dead
-- weight since migration 001 — grepped the whole app: `field_type` is
-- never read anywhere and never written as anything but the literal
-- 'text'; `field_options` is never read or written at all beyond its
-- type declaration. Safe to finally use both with zero back-compat
-- risk. The defense-in-depth CHECK below is free given every existing
-- row is already 'text'.
--
-- Definition management (create/edit/delete a group or its fields,
-- link/unlink a group to a stage) is tightened to OWNER-only — a
-- deliberate reduction of what admins could do before (they could
-- create/edit/delete any custom field). Filling in VALUES stays
-- agent+, unchanged — `contact_custom_values`/`deal_custom_values`
-- RLS is not touched by this migration except for the new
-- `deal_custom_values` table itself, which mirrors deal visibility.
--
-- `pipeline_stages.requires_contact_identity` is a separate,
-- independent boolean (not a group) for "this stage also requires the
-- linked contact to have a name and phone on file" — contacts.name/
-- phone are real columns, not custom_fields rows, so they can't live
-- inside a group's field list. RLS on this boolean stays admin+ (same
-- narrow trust model `notify_group_on_enter` already has — enforced
-- by the UI being owner-gated, not by RLS) rather than inventing a
-- dedicated owner-only presence-table just for one flag.
--
-- The old order_* columns, requires_order_info, and
-- stage_exit_requirements all stay in the DB, untouched and dormant —
-- non-destructive. The app stops reading/writing them going forward.
-- stage_exit_requirements had 0 rows on every environment we checked,
-- so no migration path is built for it (a future non-empty case would
-- need, per referenced custom_field_id, an implicit single-field
-- contact-scoped wrapper group + a stage_required_groups link).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ---- 1. Groups ---------------------------------------------------

CREATE TABLE IF NOT EXISTS custom_field_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  scope       text NOT NULL DEFAULT 'contact' CHECK (scope IN ('contact', 'deal')),
  is_active   boolean NOT NULL DEFAULT true,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_field_groups_account ON custom_field_groups(account_id);

ALTER TABLE custom_field_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_field_groups_select ON custom_field_groups;
CREATE POLICY custom_field_groups_select ON custom_field_groups FOR SELECT
  USING (is_account_member(account_id));

-- First genuinely owner-tier table in the app besides the ownership-
-- transfer RPC path. A plain RLS check is enough here (no RPC
-- needed) since, unlike ownership transfer, this isn't a cross-row
-- privileged write — it's a normal single-tenant definition write,
-- same shape as every other admin+ settings table, just a stricter
-- tier.
DROP POLICY IF EXISTS custom_field_groups_insert ON custom_field_groups;
CREATE POLICY custom_field_groups_insert ON custom_field_groups FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS custom_field_groups_update ON custom_field_groups;
CREATE POLICY custom_field_groups_update ON custom_field_groups FOR UPDATE
  USING (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS custom_field_groups_delete ON custom_field_groups;
CREATE POLICY custom_field_groups_delete ON custom_field_groups FOR DELETE
  USING (is_account_member(account_id, 'owner'));

CREATE OR REPLACE FUNCTION public.update_custom_field_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS custom_field_groups_updated_at ON custom_field_groups;
CREATE TRIGGER custom_field_groups_updated_at
  BEFORE UPDATE ON custom_field_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_custom_field_groups_updated_at();

-- ---- 2. Extend custom_fields --------------------------------------

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES custom_field_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_custom_fields_group ON custom_fields(group_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_field_type_check'
  ) THEN
    ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_field_type_check
      CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'url'));
  END IF;
END $$;

-- Tighten definition-management from admin+ to owner+. SELECT is
-- unchanged (any member can still read field definitions — needed for
-- rendering values everywhere from the sidebar to automations).
DROP POLICY IF EXISTS custom_fields_insert ON custom_fields;
CREATE POLICY custom_fields_insert ON custom_fields FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS custom_fields_update ON custom_fields;
CREATE POLICY custom_fields_update ON custom_fields FOR UPDATE
  USING (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS custom_fields_delete ON custom_fields;
CREATE POLICY custom_fields_delete ON custom_fields FOR DELETE
  USING (is_account_member(account_id, 'owner'));

-- ---- 3. Deal-scoped values -----------------------------------------

CREATE TABLE IF NOT EXISTS deal_custom_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  custom_field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, custom_field_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_custom_values_deal ON deal_custom_values(deal_id);

ALTER TABLE deal_custom_values ENABLE ROW LEVEL SECURITY;

-- Deliberately mirrors deals_select/deals_update (040) via a join
-- through deals, NOT a blanket agent+ policy — an agent restricted to
-- their assigned deals must not be able to read/write order info on a
-- deal they can't otherwise see.
DROP POLICY IF EXISTS deal_custom_values_select ON deal_custom_values;
CREATE POLICY deal_custom_values_select ON deal_custom_values FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND (
      is_account_member(d.account_id, 'admin')
      OR (
        is_account_member(d.account_id, 'agent')
        AND d.assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid())
      )
    )
  )
);

DROP POLICY IF EXISTS deal_custom_values_modify ON deal_custom_values;
CREATE POLICY deal_custom_values_modify ON deal_custom_values FOR ALL USING (
  EXISTS (
    SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND (
      is_account_member(d.account_id, 'admin')
      OR (
        is_account_member(d.account_id, 'agent')
        AND d.assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid())
      )
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND (
      is_account_member(d.account_id, 'admin')
      OR (
        is_account_member(d.account_id, 'agent')
        AND d.assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid())
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.update_deal_custom_values_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deal_custom_values_updated_at ON deal_custom_values;
CREATE TRIGGER deal_custom_values_updated_at
  BEFORE UPDATE ON deal_custom_values
  FOR EACH ROW
  EXECUTE FUNCTION public.update_deal_custom_values_updated_at();

-- ---- 4. Group-to-stage linkage -------------------------------------

CREATE TABLE IF NOT EXISTS stage_required_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id   uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES custom_field_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_required_groups_stage ON stage_required_groups(stage_id);

ALTER TABLE stage_required_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stage_required_groups_select ON stage_required_groups;
CREATE POLICY stage_required_groups_select ON stage_required_groups FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = stage_required_groups.stage_id
      AND is_account_member(p.account_id)
  )
);

-- Tightened to owner+ (043's stage_exit_requirements_modify was admin+).
DROP POLICY IF EXISTS stage_required_groups_modify ON stage_required_groups;
CREATE POLICY stage_required_groups_modify ON stage_required_groups FOR ALL USING (
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = stage_required_groups.stage_id
      AND is_account_member(p.account_id, 'owner')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = stage_required_groups.stage_id
      AND is_account_member(p.account_id, 'owner')
  )
);

-- ---- 5. Contact-identity gate (independent of any group) -----------

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS requires_contact_identity boolean NOT NULL DEFAULT false;

-- ---- 6. Backfill: migrate the old Site Visit Info feature ----------
--
-- Only runs for accounts that actually had requires_order_info=true
-- somewhere — accounts that never touched the old feature get no
-- seeded clutter. Re-run-safe: skips an account if its "Site Visit
-- Info" deal-scoped group already exists.

DO $$
DECLARE
  acct RECORD;
  v_group_id uuid;
  v_loc uuid;
  v_prod uuid;
  v_time uuid;
  v_note uuid;
  v_owner uuid;
BEGIN
  FOR acct IN
    SELECT DISTINCT p.account_id
    FROM pipeline_stages ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.requires_order_info = true
  LOOP
    SELECT id INTO v_group_id FROM custom_field_groups
      WHERE account_id = acct.account_id AND name = 'Site Visit Info' AND scope = 'deal';
    CONTINUE WHEN v_group_id IS NOT NULL;

    SELECT owner_user_id INTO v_owner FROM accounts WHERE id = acct.account_id;

    INSERT INTO custom_field_groups (account_id, name, scope, is_active, position)
      VALUES (acct.account_id, 'Site Visit Info', 'deal', true, 0)
      RETURNING id INTO v_group_id;

    INSERT INTO custom_fields (account_id, user_id, field_name, field_type, group_id, required, position)
      VALUES (acct.account_id, v_owner, 'Location', 'text', v_group_id, true, 0)
      RETURNING id INTO v_loc;
    INSERT INTO custom_fields (account_id, user_id, field_name, field_type, group_id, required, position)
      VALUES (acct.account_id, v_owner, 'Product', 'text', v_group_id, true, 1)
      RETURNING id INTO v_prod;
    INSERT INTO custom_fields (account_id, user_id, field_name, field_type, group_id, required, position)
      VALUES (acct.account_id, v_owner, 'Visit Time', 'text', v_group_id, true, 2)
      RETURNING id INTO v_time;
    INSERT INTO custom_fields (account_id, user_id, field_name, field_type, group_id, required, position)
      VALUES (acct.account_id, v_owner, 'Note', 'text', v_group_id, false, 3)
      RETURNING id INTO v_note;

    INSERT INTO stage_required_groups (stage_id, group_id)
      SELECT ps.id, v_group_id
      FROM pipeline_stages ps
      JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE p.account_id = acct.account_id AND ps.requires_order_info = true
      ON CONFLICT (stage_id, group_id) DO NOTHING;

    UPDATE pipeline_stages ps SET requires_contact_identity = true
      FROM pipelines p
      WHERE p.id = ps.pipeline_id AND p.account_id = acct.account_id AND ps.requires_order_info = true;

    INSERT INTO deal_custom_values (deal_id, custom_field_id, value)
      SELECT id, v_loc, order_location FROM deals
      WHERE account_id = acct.account_id AND order_location IS NOT NULL AND order_location <> ''
      ON CONFLICT (deal_id, custom_field_id) DO NOTHING;
    INSERT INTO deal_custom_values (deal_id, custom_field_id, value)
      SELECT id, v_prod, order_product FROM deals
      WHERE account_id = acct.account_id AND order_product IS NOT NULL AND order_product <> ''
      ON CONFLICT (deal_id, custom_field_id) DO NOTHING;
    INSERT INTO deal_custom_values (deal_id, custom_field_id, value)
      SELECT id, v_time, order_visit_time FROM deals
      WHERE account_id = acct.account_id AND order_visit_time IS NOT NULL AND order_visit_time <> ''
      ON CONFLICT (deal_id, custom_field_id) DO NOTHING;
    INSERT INTO deal_custom_values (deal_id, custom_field_id, value)
      SELECT id, v_note, order_note FROM deals
      WHERE account_id = acct.account_id AND order_note IS NOT NULL AND order_note <> ''
      ON CONFLICT (deal_id, custom_field_id) DO NOTHING;
  END LOOP;
END $$;
