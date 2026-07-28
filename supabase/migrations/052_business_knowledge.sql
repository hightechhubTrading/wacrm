-- ============================================================
-- 052_business_knowledge.sql
--
-- Gives the AI assistant business knowledge it had no way to know
-- before: product pricing, the business's social media/website links,
-- and the assigned agent's phone number for when a customer asks to
-- talk by phone.
--
-- Product pricing extends the existing ai_media_library catalog table
-- (038_ai_media_library.sql) rather than a new products table, since
-- products generally have a photo attached already. price_unit is a
-- free label ('per_meter', 'per_item', 'per_kg', ...) rather than a
-- fixed enum, so this isn't hardcoded to any one business's unit of
-- sale.
--
-- accounts.social_links is JSONB (e.g. {"instagram": "...", "website":
-- "..."}) so new platforms never need another migration.
--
-- profiles.phone is the AGENT's own number (distinct from
-- contacts.phone, the customer's number) -- today the only phone in
-- the schema is the customer's.
--
-- RLS: no change needed. ai_media_library already has account-scoped
-- RLS from 038; accounts already has admin+-gated accounts_update from
-- 017; profiles already lets a user update their own row.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_media_library
  ADD COLUMN IF NOT EXISTS price NUMERIC,
  ADD COLUMN IF NOT EXISTS price_unit TEXT;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS social_links JSONB;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;
