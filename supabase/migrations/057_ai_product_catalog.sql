-- ============================================================
-- 057_ai_product_catalog.sql
--
-- Replaces the file-per-row ai_media_library (038, extended by 053)
-- with two tables: ai_products (name/description/pricing, entered
-- once per product) and ai_product_media (any number of files per
-- product, each with an optional short label). Fixes two problems
-- with the old shape: (1) a product with a photo AND a catalog PDF
-- needed its info retyped across two rows, and (2) the AI's
-- productTagId sentinel had no way to flag "this product is the
-- topic" independently of "this specific file" -- both referenced
-- the same flat-list id. See docs/superpowers/specs/
-- 2026-08-01-ai-product-catalog-design.md.
--
-- account_id is denormalized onto ai_product_media (not resolved via
-- a join through ai_products) so its RLS policies stay the same
-- shape as ai_media_library's today -- matching how contacts/
-- conversations already do account-scoped RLS in this schema.
--
-- tag_id keeps ai_media_library's exact FK
-- (ai_media_library_tag_id_fkey -> tags(id) ON DELETE SET NULL).
--
-- Backfill reuses each ai_media_library row's own id as the new
-- ai_products.id -- nothing else in the schema has a FK to
-- ai_media_library.id, so this is safe and avoids joining the two
-- inserts back together by name/timestamp.
--
-- Idempotent -- safe to run multiple times, EXCEPT the backfill
-- INSERT block, which only makes sense while ai_media_library still
-- exists; on a second run the table is already gone and the DO block
-- below no-ops (guarded by to_regclass).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL,
  tag_label text,
  tag_id uuid REFERENCES tags(id) ON DELETE SET NULL,
  price_min numeric,
  price_max numeric,
  price_unit text,
  price_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_products_price_range_check
    CHECK (price_min IS NULL OR price_max IS NULL OR price_max >= price_min)
);

CREATE INDEX IF NOT EXISTS ai_products_account_id_idx
  ON ai_products (account_id);

ALTER TABLE ai_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_products_select ON ai_products;
CREATE POLICY ai_products_select ON ai_products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_products_insert ON ai_products;
CREATE POLICY ai_products_insert ON ai_products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_products_update ON ai_products;
CREATE POLICY ai_products_update ON ai_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_products_delete ON ai_products;
CREATE POLICY ai_products_delete ON ai_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_products_updated_at ON ai_products;
CREATE TRIGGER ai_products_updated_at
  BEFORE UPDATE ON ai_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_products_updated_at();

CREATE TABLE IF NOT EXISTS ai_product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ai_products(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label text,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'document')),
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_product_media_product_id_idx
  ON ai_product_media (product_id);
CREATE INDEX IF NOT EXISTS ai_product_media_account_id_idx
  ON ai_product_media (account_id);

ALTER TABLE ai_product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_product_media_select ON ai_product_media;
CREATE POLICY ai_product_media_select ON ai_product_media FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_product_media_insert ON ai_product_media;
CREATE POLICY ai_product_media_insert ON ai_product_media FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_product_media_update ON ai_product_media;
CREATE POLICY ai_product_media_update ON ai_product_media FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_product_media_delete ON ai_product_media;
CREATE POLICY ai_product_media_delete ON ai_product_media FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Backfill + cutover. Guarded so re-running this migration after
-- ai_media_library is already gone is a safe no-op.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.ai_media_library') IS NOT NULL THEN
    INSERT INTO ai_products (id, account_id, created_by, name, description,
      tag_label, tag_id, price_min, price_max, price_unit, price_notes,
      created_at, updated_at)
    SELECT id, account_id, created_by, name, description,
      product_label, tag_id, price_min, price_max, price_unit, price_notes,
      created_at, updated_at
    FROM ai_media_library
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO ai_product_media (product_id, account_id, storage_path,
      mime_type, media_kind, file_size, created_at)
    SELECT id, account_id, storage_path, mime_type, media_kind, file_size,
      created_at
    FROM ai_media_library;

    DROP TABLE ai_media_library;
  END IF;
END $$;
