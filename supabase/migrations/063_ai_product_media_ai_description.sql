-- ============================================================
-- 063_ai_product_media_ai_description.sql -- AI-generated photo
-- descriptions for product media (spec:
-- docs/superpowers/specs/2026-09-01-product-catalog-media-management-design.md)
--
-- Reuses the existing photo-analysis pipeline (migration 054,
-- src/lib/ai/vision.ts) that already captions inbound customer
-- photos, applied instead to uploaded product images so the AI can
-- tell multiple photos of the same product apart by more than a
-- manual label.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_product_media
  ADD COLUMN IF NOT EXISTS ai_description text;
