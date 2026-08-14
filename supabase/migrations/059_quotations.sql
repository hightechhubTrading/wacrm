-- ============================================================
-- 059_quotations.sql
--
-- Quotations as a new module: any staff member can create a priced,
-- bilingual quotation — optionally linked to a contact and/or deal,
-- never required to be — with a flexible item tree (sections, top-
-- level products, and accessory/customization sub-items under any
-- product), per-item and per-order discounts, and a self-growing
-- shared catalog of products/parts/accessories that doubles as the
-- seed of a future inventory table.
--
-- No existing table changes shape. Unlike 044's order_info (which
-- added columns to `deals`), this needs nothing on `deals` at all —
-- the relationship points outward from the new `quotations` table.
-- `ai_products` (057) is untouched; it keeps serving the AI reply bot
-- independently of this catalog.
--
-- RLS on `quotations` mirrors deals_select/update/delete (040)
-- exactly: admin sees/edits everything in the account, agent only
-- what's assigned to them via `assigned_to` -> profiles.id.
--
-- See docs/superpowers/specs/2026-08-14-quotations-design.md.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ── Catalog: products, parts, accessories, materials ──────────
-- Seed of a future inventory table -- stock_qty/cost_price/supplier
-- get added onto THIS table later, additively, not a new one.
CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'product',
  name text NOT NULL,
  name_ar text,
  description text,
  description_ar text,
  sku text,
  unit_of_measure text,
  default_unit_price numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_items_account_id_idx ON catalog_items (account_id);
-- Plain btree + ILIKE, not pg_trgm (not enabled anywhere in this repo;
-- catalog scale doesn't need fuzzy matching). See plan Global Constraints.
CREATE INDEX IF NOT EXISTS catalog_items_name_lower_idx ON catalog_items (lower(name));

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_items_select ON catalog_items;
CREATE POLICY catalog_items_select ON catalog_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS catalog_items_insert ON catalog_items;
CREATE POLICY catalog_items_insert ON catalog_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_items_update ON catalog_items;
CREATE POLICY catalog_items_update ON catalog_items FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_items_delete ON catalog_items;
CREATE POLICY catalog_items_delete ON catalog_items FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_catalog_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS catalog_items_updated_at ON catalog_items;
CREATE TRIGGER catalog_items_updated_at
  BEFORE UPDATE ON catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_items_updated_at();

-- ── Reference numbering: HT-YY-CODE-NNN, race-safe ─────────────
CREATE TABLE IF NOT EXISTS quotation_product_codes (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  PRIMARY KEY (account_id, code)
);

ALTER TABLE quotation_product_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotation_product_codes_select ON quotation_product_codes;
CREATE POLICY quotation_product_codes_select ON quotation_product_codes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS quotation_product_codes_write ON quotation_product_codes;
CREATE POLICY quotation_product_codes_write ON quotation_product_codes FOR ALL
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS quotation_sequences (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  year text NOT NULL,
  code text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, year, code)
);

ALTER TABLE quotation_sequences ENABLE ROW LEVEL SECURITY;

-- No direct client access -- only next_quotation_reference() (SECURITY
-- DEFINER, below) touches this table. No SELECT/INSERT/UPDATE policy
-- is added on purpose: RLS enabled with zero policies denies all
-- direct client access while the function itself bypasses RLS.

CREATE OR REPLACE FUNCTION next_quotation_reference(p_account_id uuid, p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(now(), 'YY');
  v_n integer;
BEGIN
  INSERT INTO quotation_sequences (account_id, year, code, next_number)
  VALUES (p_account_id, v_year, p_code, 2)
  ON CONFLICT (account_id, year, code)
  DO UPDATE SET next_number = quotation_sequences.next_number + 1
  RETURNING next_number - 1 INTO v_n;
  RETURN 'HT-' || v_year || '-' || p_code || '-' || lpad(v_n::text, 3, '0');
END;
$$;

ALTER FUNCTION next_quotation_reference(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION next_quotation_reference(uuid, text) TO authenticated, service_role;

-- ── Quotations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  reference text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'won', 'lost', 'expired')),

  client_name text,
  client_phone text,
  client_company text,
  location text,
  project_name text,

  subject text,
  currency text,

  discount_type text CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric,
  discount_reason text,

  subtotal numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,

  valid_until date,
  delivery_terms text,
  payment_terms text,
  warranty_terms text DEFAULT 'One year from handover',

  pdf_storage_path text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, reference)
);

CREATE INDEX IF NOT EXISTS quotations_account_id_idx ON quotations (account_id);
CREATE INDEX IF NOT EXISTS quotations_assigned_to_idx ON quotations (assigned_to);
CREATE INDEX IF NOT EXISTS quotations_contact_id_idx ON quotations (contact_id);
CREATE INDEX IF NOT EXISTS quotations_deal_id_idx ON quotations (deal_id);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotations_select ON quotations;
CREATE POLICY quotations_select ON quotations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

DROP POLICY IF EXISTS quotations_insert ON quotations;
CREATE POLICY quotations_insert ON quotations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS quotations_update ON quotations;
CREATE POLICY quotations_update ON quotations FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

DROP POLICY IF EXISTS quotations_delete ON quotations;
CREATE POLICY quotations_delete ON quotations FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

CREATE OR REPLACE FUNCTION public.update_quotations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotations_updated_at ON quotations;
CREATE TRIGGER quotations_updated_at
  BEFORE UPDATE ON quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_quotations_updated_at();

-- ── Quotation items: sections, products, accessories/customizations ──
CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  parent_item_id uuid REFERENCES quotation_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  item_type text NOT NULL DEFAULT 'line' CHECK (item_type IN ('section', 'line')),
  kind text,

  item_code text,
  description text,
  description_ar text,
  size_w numeric,
  size_h numeric,
  qty numeric DEFAULT 1,
  unit_price numeric,

  discount_type text CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric,
  line_total numeric NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotation_items_quotation_id_idx ON quotation_items (quotation_id);
CREATE INDEX IF NOT EXISTS quotation_items_parent_item_id_idx ON quotation_items (parent_item_id);
CREATE INDEX IF NOT EXISTS quotation_items_account_id_idx ON quotation_items (account_id);

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotation_items_select ON quotation_items;
CREATE POLICY quotation_items_select ON quotation_items FOR SELECT
  USING (is_account_member(account_id));

-- Re-checks the PARENT quotation's own assigned_to rule, not just "does
-- some quotation with this id exist" -- see spec self-review note.
DROP POLICY IF EXISTS quotation_items_write ON quotation_items;
CREATE POLICY quotation_items_write ON quotation_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM quotations q
    WHERE q.id = quotation_items.quotation_id
      AND (
        is_account_member(q.account_id, 'admin')
        OR (is_account_member(q.account_id, 'agent')
            AND q.assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
      )
  )
);

-- ── Seed product codes, matching the product lines in the reviewed
-- example quotations (see spec Data model). accountless seed: applied
-- per-account by the app on first use (Task 5), not hardcoded here,
-- since this migration has no account_id to seed against yet.
