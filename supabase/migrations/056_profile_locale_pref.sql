-- supabase/migrations/056_profile_locale_pref.sql
-- ============================================================
-- Per-user locale (UI language) preference on `profiles`.
--
-- Mirrors migration 042 (theme/mode): NULLABLE with no DEFAULT.
-- NULL means "this user has never picked a language on any device",
-- which LocaleSync (src/components/locale-sync.tsx) needs to tell
-- apart from "picked English" so it knows when to back-fill instead
-- of applying.
--
-- No CHECK constraint, same reasoning as 042: isLocaleId() in
-- src/lib/locales.ts already narrows unknown values on every read
-- path, so a DB enum would turn "add a locale" into a two-file-and-
-- a-migration change instead of two files.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT;

-- No new RLS policy needed: the existing `Users can view own profile` /
-- `Users can update own profile` policies (migration 001) already gate
-- access to this column, and locale is strictly a self-service
-- preference — no admin/owner gate.
