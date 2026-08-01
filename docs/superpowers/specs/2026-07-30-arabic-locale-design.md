# Replace Korean with a switchable Arabic locale

Date: 2026-07-30

## Problem

The app ships two message dictionaries, `messages/en.json` and
`messages/ko.json`, but there is no way to change language from inside
the running app — `src/i18n/request.ts` reads a single, build-time
env var (`NEXT_PUBLIC_APP_LOCALE`) and that's it. Korean is also not a
language this product needs; Arabic is. This spec replaces Korean with
Arabic and adds a real, per-user, in-app language switcher.

## Goals

- A user can switch the app's language from Settings → Appearance and
  see it take effect immediately, without a redeploy.
- The choice persists across sessions and follows the user across
  devices (mirroring how theme/mode already do).
- Arabic renders right-to-left on the highest-traffic screens.
- Korean is fully removed; Arabic is fully translated.

## Non-goals

- URL-based locale routing (`/en/...`, `/ar/...`). The app has no
  `[locale]` route segment today and adding one would touch every
  route file for no benefit over a cookie.
- Exhaustive RTL correctness across every screen. Flow canvas, kanban
  pipelines, and other dense/absolutely-positioned screens get
  `dir="rtl"` (so text and native scroll behavior flip) but their
  internal Tailwind spacing is not hand-corrected in this pass.
- Native-speaker review of the Arabic translation. The initial
  `ar.json` is machine-translated by Claude; a fluency/terminology
  pass by a native speaker is a follow-up, not a blocker for shipping.
- A header quick-toggle. The switcher lives only in Settings →
  Appearance.

## Architecture

### Why this can't reuse the theme/mode pattern as-is

Theme and mode (`src/hooks/use-theme.tsx`, `src/lib/themes.ts`) are
pure CSS: a `data-theme`/`data-mode` attribute swapped on `<html>`
client-side, backed by `localStorage` and a no-flash boot script. That
works because nothing about *what* was server-rendered needs to
change — only which CSS variables apply.

Locale is different: `next-intl`'s `getMessages()` / `getTranslations()`
determine the actual server-rendered text. `localStorage` can't be read
during server rendering, so it cannot be the source of truth. The
locale must be resolved from something the server can see on every
request — a cookie.

### Locale resolution (server-side)

`src/i18n/request.ts` changes from:

```ts
const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
```

to reading a `wacrm.locale` cookie via `next/headers` `cookies()`,
validated against `LOCALE_IDS`, with this precedence:

1. `wacrm.locale` cookie (per-device, set by the switcher or by
   `LocaleSync` on login)
2. `NEXT_PUBLIC_APP_LOCALE` env var (org-wide deploy-time default,
   kept for installs that never touch the switcher)
3. `"en"`

### New `src/lib/locales.ts`

Mirrors the shape of `src/lib/themes.ts`:

```ts
export const LOCALE_IDS = ["en", "ar"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];
export const DEFAULT_LOCALE: LocaleId = "en";
export const LOCALE_COOKIE = "wacrm.locale";
export function isLocaleId(value: unknown): value is LocaleId { ... }
export const LOCALES: ReadonlyArray<{ id: LocaleId; name: string; dir: "ltr" | "rtl" }> = [
  { id: "en", name: "English", dir: "ltr" },
  { id: "ar", name: "العربية", dir: "rtl" },
];
```

### Switching flow

A Server Action (`setLocaleAction(locale: LocaleId)`, colocated with
the switcher or in `src/lib/locales.ts`) sets the `wacrm.locale`
cookie via `cookies().set()`. The Settings → Appearance language
control calls it, then — mirroring `useAppearance()`'s persist step —
writes `profiles.locale` if signed in, then calls `router.refresh()`.
`router.refresh()` re-runs the server tree including the root layout,
so `next-intl` picks up the new cookie and `<html lang>` / `<html
dir>` and all translated strings update in place, no full reload.

Apply-then-persist ordering follows `useAppearance()`: the cookie
write (which drives the immediate visual change) happens before the
`profiles` write, so a failed/slow DB round-trip never blocks or
reverts what the user just saw. A toast surfaces persist failure,
same as `useAppearance()`.

### Cross-device sync — `LocaleSync`

New component, sibling to `src/components/theme-sync.tsx`, rendered
in the same place (inside `AuthProvider`'s subtree). Same reconcile-
once-per-profile logic as `ThemeSync`:

- `profile.locale` is a valid `LocaleId` and differs from the current
  locale → call `setLocaleAction` + `router.refresh()`.
- `profile.locale` is null/invalid → back-fill it from the current
  (cookie-resolved) locale.

### Migration

`supabase/migrations/055_profile_locale_pref.sql`:

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT;
```

Nullable, no default, no CHECK constraint — same reasoning as
migration 042 (theme/mode): `isLocaleId()` already narrows unknown
values on every read path, and a DB enum would turn "add a locale"
into a two-file-and-a-migration change.

### RTL

`src/app/layout.tsx`: `<html lang={locale} dir={dir}>` where `dir`
comes from the resolved `LOCALES` entry (`getLocale()` is already
called here). This is the one change that must be unconditionally
correct — it drives the browser's native bidi handling (text runs,
form controls, scrollbars) independent of any Tailwind class.

Hand-fixed directional Tailwind (`pl-`/`pr-`/`ml-`/`mr-`/`text-left`/
`text-right`/positioned chevrons) on:

- App shell: sidebar nav, header, mobile nav
- Settings (all panels)
- Inbox: conversation list, message thread, composer
- Common form patterns: contact form, broadcast wizard steps

Everything else inherits `dir="rtl"` (text direction, native scroll)
without a manual spacing pass.

### Settings UI

`src/components/settings/appearance-panel.tsx` gains a "Language"
control using the same visual pattern as the existing theme/mode
pickers (segmented control), listing `LOCALES` by `name`.

### Hardcoded locale references to fix

Both currently read `process.env.NEXT_PUBLIC_APP_LOCALE` directly,
which stops reflecting the real per-user locale once switching is
dynamic:

- `src/components/inbox/message-composer.tsx:328` (draft-translate
  target language)
- `src/components/inbox/message-actions.tsx:20` (quick-translate
  default target language)

Both move to `useLocale()` (next-intl's client hook, available via
the existing `NextIntlClientProvider`), and the
`"ko" ? "English" : "Korean"` ternary becomes
`"ar" ? "English" : "Arabic"`.

`.env.local.example`: update the `NEXT_PUBLIC_APP_LOCALE` comment to
note it's now an org-wide default, not the only way to change
language.

### Content

- Delete `messages/ko.json`.
- Create `messages/ar.json`: full translation of `en.json`'s 13
  namespaces (LoginPage, Sidebar, Header, ModeToggle, Dashboard,
  Inbox, Contacts, CustomFieldGroups, Pipelines, Broadcasts,
  Automations, Flows, Settings — ~1560 keys), same structure and key
  names, ICU interpolation placeholders (`{name}`, plural/select
  syntax) preserved byte-for-byte, only surrounding text translated.

### Tests

- `src/lib/ai/context.test.ts`, `src/lib/ai/generate.test.ts`, and
  any other `src/lib/ai/*.test.ts` with hardcoded `"Korean"` target-
  language assertions get updated to `"Arabic"`.
- `src/middleware.test.ts` — checked for locale-cookie interactions;
  update only if it currently asserts on cookies untouched by this
  change (expected: no change needed, middleware is auth-only).

## Rollout

Single change, no feature flag — Korean is unused in production
today (per the user), so there's no migration path to preserve for
existing Korean-language users.
