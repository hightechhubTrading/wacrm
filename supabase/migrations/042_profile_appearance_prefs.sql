-- ============================================================
-- Per-user appearance preferences on `profiles`.
--
-- Until now the accent theme and light/dark mode lived only in
-- localStorage (`wacrm.theme` / `wacrm.mode`), so the choice was
-- device-scoped — sign in on a second machine and you were back to
-- the defaults. These two columns mirror the choice to the profile
-- row so it follows the user across devices.
--
-- Why NULLABLE with no DEFAULT:
--   `NULL` means "this user has never picked on any device", which is
--   NOT the same as "picked the default". If we stamped
--   'violet'/'dark' onto every existing row here, the sync-on-login
--   path would then push those values down and clobber whatever the
--   user had already chosen in localStorage. Nullable lets the client
--   backfill from the local choice on first login instead.
--
-- Why no CHECK constraint (unlike accounts.default_currency in 021):
--   `isThemeId()` / `isMode()` in src/lib/themes.ts already narrow
--   unknown values to the default on every read path — the same
--   defensive narrowing readInitialTheme() has always done for
--   localStorage, which is equally untrusted. A DB-side enum would
--   turn "add a theme" from a two-file change into a change that also
--   needs a migration, which the themes.ts header explicitly promises
--   it isn't.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme TEXT,
  ADD COLUMN IF NOT EXISTS mode  TEXT;

-- No new RLS policy needed: the existing `Users can view own profile` /
-- `Users can update own profile` policies (migration 001) already gate
-- access to these columns, and appearance is strictly a self-service
-- preference — no admin/owner gate, unlike account-wide settings.
--
-- No index needed: read once on the login codepath (single row lookup
-- by user_id, already indexed) and written only when a user picks a
-- theme from Settings → Appearance.
