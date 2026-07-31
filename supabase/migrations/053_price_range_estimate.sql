-- ============================================================
-- 053_price_range_estimate.sql
--
-- Lets the AI assistant share a caveated price ESTIMATE for a catalog
-- item instead of the previous all-or-nothing "never state a price"
-- rule (migration 052). Replaces the single fixed `price` column with
-- a range (`price_min`/`price_max`) -- when both are set, the model
-- may share that range as a clearly-labeled estimate (never a single
-- confirmed number); an item with no range configured keeps today's
-- strict behavior exactly as before (see defaults.ts).
--
-- `price_notes` is a free-text field for addon/option pricing the
-- range alone doesn't capture (e.g. "Automatic +$60, manual included;
-- custom colors +$20; motor add-on +$50-80") -- the model references
-- it as-is alongside the range rather than computing combinations.
--
-- Existing single-price items are backfilled into a zero-width range
-- (price_min = price_max = price) before the old column is dropped, so
-- nothing goes blank on upgrade.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_media_library
  ADD COLUMN IF NOT EXISTS price_min NUMERIC,
  ADD COLUMN IF NOT EXISTS price_max NUMERIC,
  ADD COLUMN IF NOT EXISTS price_notes TEXT;

UPDATE ai_media_library
  SET price_min = price, price_max = price
  WHERE price IS NOT NULL AND price_min IS NULL AND price_max IS NULL;

ALTER TABLE ai_media_library DROP COLUMN IF EXISTS price;

ALTER TABLE ai_media_library DROP CONSTRAINT IF EXISTS ai_media_library_price_range_check;
ALTER TABLE ai_media_library ADD CONSTRAINT ai_media_library_price_range_check
  CHECK (price_min IS NULL OR price_max IS NULL OR price_max >= price_min);
