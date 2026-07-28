-- ============================================================
-- 044_deal_order_info.sql
--
-- Dedicated per-DEAL order fields — Location, Product, Visit Time,
-- Note — for the site-visit/measurement workflow. Deliberately NOT
-- built on the generic `custom_fields`/`contact_custom_values` system
-- (migration 041): that system is CONTACT-scoped (one row per
-- contact per field), so a returning client's second order would
-- silently overwrite the first order's Location/Product/Time in the
-- same row. These need to live on `deals` itself so each order keeps
-- its own values independently.
--
-- Client name/phone are intentionally NOT duplicated here — read
-- from `contacts.name`/`contacts.phone` wherever needed.
--
-- `pipeline_stages.requires_order_info` is a single flag driving
-- three consumers (app-side, no further schema needed):
--   (a) opens the "Order Info" popup when a deal ENTERS a flagged
--       stage (src/app/(dashboard)/pipelines/page.tsx)
--   (b) adds the 4 order fields to the AI bot's collectible-field
--       prompt when the contact's current open deal sits in a
--       flagged stage (src/lib/ai/collect-fields.ts)
--   (c) gates LEAVING a flagged stage until Location, Product, Time,
--       contact name, and contact phone are filled — Note stays
--       optional (src/app/api/pipelines/deals/[id]/move/route.ts)
--
-- No RLS changes needed: `deals_update` (017, tightened by 040) and
-- `pipeline_stages`'s existing select/modify policies (017) are
-- row-level, not column-level — these new nullable columns are
-- covered automatically, exactly like `notes`/`value` today.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS order_location   text,
  ADD COLUMN IF NOT EXISTS order_product    text,
  ADD COLUMN IF NOT EXISTS order_visit_time text,
  ADD COLUMN IF NOT EXISTS order_note       text;

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS requires_order_info boolean NOT NULL DEFAULT false;
