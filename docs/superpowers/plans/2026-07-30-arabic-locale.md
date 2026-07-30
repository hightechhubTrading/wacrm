# Switchable Arabic Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unused Korean locale with a fully translated Arabic locale, add a real in-app language switcher (Settings → Appearance) that persists per-user and across devices, and give Arabic real (if not exhaustive) RTL layout support.

**Architecture:** Locale is resolved server-side on every request from a `wacrm.locale` cookie (read in `src/i18n/request.ts`), falling back to the `NEXT_PUBLIC_APP_LOCALE` env var, then `"en"`. The Settings → Appearance switcher calls a new `/api/locale` route to set that cookie, writes `profiles.locale` for cross-device sync (mirroring the existing theme/mode pattern), and calls `router.refresh()` so the server tree — including `<html lang>`/`<html dir>` and all `next-intl` translations — re-renders with the new locale, no full page reload. A `LocaleSync` component (sibling to the existing `ThemeSync`) reconciles the cookie with `profiles.locale` on login.

**Tech Stack:** Next.js App Router, `next-intl` 4.x, Supabase (Postgres + `@supabase/ssr`), Tailwind CSS v4 (logical-property utilities for RTL), Vitest.

## Global Constraints

- Every JSON key in `messages/ar.json` must exist at the exact same path in `messages/en.json`, and vice versa — no missing or extra keys.
- Every `{placeholder}` / ICU plural-select token in an `en.json` string must appear, unchanged (same name, same casing), in the corresponding `ar.json` string.
- Arabic translations use professional Modern Standard Arabic (MSA) suited to a business WhatsApp CRM — not overly formal/classical, not colloquial/dialectal.
- Brand and technical terms stay in Latin script (common convention in Arabic tech UIs): WhatsApp, API, URL, CRM, AI, provider names (OpenAI, Anthropic, Google, etc.), and product-specific proper nouns (Hightech Hub).
- RTL layout conversions use Tailwind's logical-property utilities (`ps-*`/`pe-*`, `ms-*`/`me-*`, `start-*`/`end-*`, `text-start`/`text-end`, `border-s-*`/`border-e-*`, `rounded-s-*`/`rounded-e-*`/`rounded-ss-*`/`rounded-se-*`/`rounded-es-*`/`rounded-ee-*`) — never a `locale === "ar" ? ... : ...` conditional class.
- Client components read the current locale via `useLocale()` from `next-intl` — never `process.env.NEXT_PUBLIC_APP_LOCALE` directly (that env var is now only the deploy-time default read inside `src/i18n/request.ts`).
- `messages/ko.json` and every reference to Korean/`"ko"` as a locale value are removed by the end of this plan.

---

## Task 1: Locale metadata module

**Files:**
- Create: `src/lib/locales.ts`
- Test: `src/lib/locales.test.ts`

**Interfaces:**
- Produces: `LOCALE_IDS: readonly ["en", "ar"]`, `type LocaleId = "en" | "ar"`, `DEFAULT_LOCALE: LocaleId`, `LOCALE_COOKIE: string`, `isLocaleId(value: unknown): value is LocaleId`, `interface LocaleMeta { id: LocaleId; name: string; dir: "ltr" | "rtl" }`, `LOCALES: ReadonlyArray<LocaleMeta>`, `localeDir(locale: string): "ltr" | "rtl"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/locales.test.ts
import { describe, expect, it } from "vitest";
import { isLocaleId, localeDir, LOCALE_IDS, LOCALES } from "./locales";

describe("isLocaleId", () => {
  it("accepts every id in LOCALE_IDS", () => {
    for (const id of LOCALE_IDS) {
      expect(isLocaleId(id)).toBe(true);
    }
  });

  it("rejects unknown or non-string values", () => {
    expect(isLocaleId("ko")).toBe(false);
    expect(isLocaleId("fr")).toBe(false);
    expect(isLocaleId(null)).toBe(false);
    expect(isLocaleId(undefined)).toBe(false);
    expect(isLocaleId(42)).toBe(false);
  });
});

describe("localeDir", () => {
  it("returns rtl for ar", () => {
    expect(localeDir("ar")).toBe("rtl");
  });

  it("returns ltr for en and for unknown locales", () => {
    expect(localeDir("en")).toBe("ltr");
    expect(localeDir("xx")).toBe("ltr");
  });

  it("has a LOCALES entry for every LOCALE_IDS id", () => {
    expect(LOCALES.map((l) => l.id).sort()).toEqual([...LOCALE_IDS].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/locales.test.ts`
Expected: FAIL — `src/lib/locales.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/locales.ts
/**
 * Single source of truth for the UI-language catalog.
 *
 * Mirrors the shape of src/lib/themes.ts: a fixed id list, a default,
 * and a metadata array the switcher and layout read from. `dir` here
 * is what src/app/layout.tsx sets on <html> — everything else (RTL
 * spacing on individual screens) is handled per-component.
 *
 * Adding a locale is a three-step change:
 *   1. Add the id to LOCALE_IDS.
 *   2. Add its LocaleMeta entry to LOCALES.
 *   3. Add messages/<id>.json with the same key structure as en.json.
 */

export const LOCALE_IDS = ["en", "ar"] as const;

export type LocaleId = (typeof LOCALE_IDS)[number];

export const DEFAULT_LOCALE: LocaleId = "en";

/** Cookie src/i18n/request.ts reads and /api/locale writes. */
export const LOCALE_COOKIE = "wacrm.locale";

export function isLocaleId(value: unknown): value is LocaleId {
  return (
    typeof value === "string" &&
    (LOCALE_IDS as readonly string[]).includes(value)
  );
}

export interface LocaleMeta {
  id: LocaleId;
  /** Native display name, shown as-is regardless of the active locale
   *  (same convention as ThemeMeta.name in themes.ts). */
  name: string;
  dir: "ltr" | "rtl";
}

export const LOCALES: ReadonlyArray<LocaleMeta> = [
  { id: "en", name: "English", dir: "ltr" },
  { id: "ar", name: "العربية", dir: "rtl" },
];

export function localeDir(locale: string): "ltr" | "rtl" {
  return LOCALES.find((l) => l.id === locale)?.dir ?? "ltr";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/locales.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/locales.ts src/lib/locales.test.ts
git commit -m "Add locale metadata module (en/ar)"
```

---

## Task 2: `profiles.locale` column + Profile type

**Files:**
- Create: `supabase/migrations/055_profile_locale_pref.sql`
- Modify: `src/hooks/use-auth.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Profile.locale: string | null` (loose string, same reasoning as `Profile.theme`/`Profile.mode` — no DB CHECK constraint, narrow with `isLocaleId()` at every read site).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/055_profile_locale_pref.sql
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
```

- [ ] **Step 2: Apply the migration locally**

Run: `supabase migration up` (or the project's usual local-migration command)
Expected: `055_profile_locale_pref` applied without error; `profiles.locale` column exists.

- [ ] **Step 3: Add `locale` to the `Profile` type and fetch path**

In `src/hooks/use-auth.tsx`, add the field to the `Profile` interface, right after `mode`:

```ts
  theme: string | null;
  mode: string | null;
  /**
   * UI language, mirrored from the device choice so it follows the
   * user across devices (migration 055). Same nullability contract
   * as theme/mode: `null` means "never chosen anywhere" — see
   * <LocaleSync>. Loose string, narrow with `isLocaleId()`.
   */
  locale: string | null;
  account_id: string | null;
```

In the `fetchProfile` Supabase `.select(...)` call, add `locale` to the column list:

```ts
        .select(
          "id, full_name, email, avatar_url, role, beta_features, theme, mode, locale, account_id, account_role, phone",
        )
```

In the `setProfile({...})` call, add the field next to `mode`:

```ts
          theme: data.theme ?? null,
          mode: data.mode ?? null,
          locale: data.locale ?? null,
          account_id: data.account_id ?? null,
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/055_profile_locale_pref.sql src/hooks/use-auth.tsx
git commit -m "Add profiles.locale column for per-user language sync"
```

---

## Task 3: Cookie-based locale resolution

**Files:**
- Modify: `src/i18n/request.ts`
- Test: `src/i18n/request.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_LOCALE`, `isLocaleId`, `LOCALE_COOKIE` from `src/lib/locales.ts` (Task 1).
- Produces: `src/i18n/request.ts`'s default export resolves `{ locale, messages }` from, in order: the `wacrm.locale` cookie, `NEXT_PUBLIC_APP_LOCALE`, `"en"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/i18n/request.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.get })),
}));

import requestConfig from "./request";

describe("i18n request config", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockReturnValue(undefined);
    delete process.env.NEXT_PUBLIC_APP_LOCALE;
  });

  it("uses the locale cookie when it's a known locale", async () => {
    mocks.get.mockReturnValue({ value: "ar" });
    const config = await requestConfig();
    expect(config.locale).toBe("ar");
  });

  it("falls back to NEXT_PUBLIC_APP_LOCALE when the cookie is missing", async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = "ar";
    const config = await requestConfig();
    expect(config.locale).toBe("ar");
  });

  it("falls back to en when neither the cookie nor the env var is set", async () => {
    const config = await requestConfig();
    expect(config.locale).toBe("en");
  });

  it("ignores an invalid cookie value and falls back", async () => {
    mocks.get.mockReturnValue({ value: "ko" });
    const config = await requestConfig();
    expect(config.locale).toBe("en");
  });

  it("loads the messages file matching the resolved locale", async () => {
    mocks.get.mockReturnValue({ value: "ar" });
    const config = await requestConfig();
    expect(config.messages).toBeDefined();
    expect((config.messages as Record<string, unknown>).LoginPage).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/i18n/request.test.ts`
Expected: FAIL — current `request.ts` only reads `process.env.NEXT_PUBLIC_APP_LOCALE`, so the cookie-based cases (1st and 4th `it`) fail.

- [ ] **Step 3: Write the implementation**

```ts
// src/i18n/request.ts
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocaleId } from '@/lib/locales';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const envLocale = process.env.NEXT_PUBLIC_APP_LOCALE;

  const locale = isLocaleId(cookieLocale)
    ? cookieLocale
    : isLocaleId(envLocale)
      ? envLocale
      : DEFAULT_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  return {
    locale,
    messages
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/i18n/request.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/i18n/request.ts src/i18n/request.test.ts
git commit -m "Resolve locale from a cookie, falling back to the env default"
```

---

## Task 4: `/api/locale` route

**Files:**
- Create: `src/app/api/locale/route.ts`
- Test: `src/app/api/locale/route.test.ts`

**Interfaces:**
- Consumes: `isLocaleId`, `LOCALE_COOKIE` from `src/lib/locales.ts` (Task 1).
- Produces: `POST /api/locale` — body `{ locale: string }`, sets the `wacrm.locale` cookie when `locale` is a known `LocaleId`, else `400`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/locale/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.set })),
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.set.mockReset();
});

describe("POST /api/locale", () => {
  it("sets the locale cookie for a known locale", async () => {
    const res = await POST(request({ locale: "ar" }));
    expect(res.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(
      "wacrm.locale",
      "ar",
      expect.objectContaining({ path: "/" }),
    );
    const json = await res.json();
    expect(json).toEqual({ locale: "ar" });
  });

  it("rejects an unknown locale", async () => {
    const res = await POST(request({ locale: "ko" }));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rejects a missing locale", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/locale/route.test.ts`
Expected: FAIL — `src/app/api/locale/route.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/api/locale/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocaleId, LOCALE_COOKIE } from "@/lib/locales";

/**
 * POST /api/locale
 *
 * Body: { locale }
 * Sets the wacrm.locale cookie src/i18n/request.ts reads. No auth
 * gate — language is a self-service, per-device preference usable
 * even signed out (e.g. on /login), same reasoning as appearance.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const locale = body && typeof body.locale === "string" ? body.locale : "";

  if (!isLocaleId(locale)) {
    return NextResponse.json({ error: "Unknown locale" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return NextResponse.json({ locale });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/locale/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/locale/route.ts src/app/api/locale/route.test.ts
git commit -m "Add /api/locale route to set the locale cookie"
```

---

## Task 5: `useLocalePreference` hook + new Appearance strings

**Files:**
- Create: `src/hooks/use-locale-preference.tsx`
- Modify: `messages/en.json` (`Settings.appearance` namespace)

**Interfaces:**
- Consumes: `LocaleId` from `src/lib/locales.ts` (Task 1); `useAuth()` from `src/hooks/use-auth.tsx` (Task 2, for `profile.id`).
- Produces: `useLocalePreference(): { locale: LocaleId; setLocale: (next: LocaleId) => Promise<void> }`.

- [ ] **Step 1: Add the two new translation keys**

In `messages/en.json`, inside `Settings.appearance`, add `language`, `useLanguage`, and `switchFailed` (keep existing keys as-is):

```json
    "syncFailed": "Couldn't save your appearance preference. It still applies on this device.",
    "language": "Language",
    "useLanguage": "Use {name}",
    "switchFailed": "Couldn't switch language. Please try again."
```

(Insert these three lines after the existing `"syncFailed"` line, inside the `Settings.appearance` object — remember to add a comma after `"syncFailed": "..."` since it's no longer the last key.)

- [ ] **Step 2: Write the hook**

```tsx
// src/hooks/use-locale-preference.tsx
"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import type { LocaleId } from "@/lib/locales";

/**
 * useLocalePreference — switch the app's UI language.
 *
 * Unlike useAppearance() (theme/mode), there is no "apply locally,
 * then persist" split: the translated text is rendered server-side,
 * so the cookie write IS the apply step. router.refresh() re-runs
 * the server tree (root layout included) with the new cookie, which
 * is what actually changes <html lang>/<html dir> and every
 * translated string — no full page reload.
 *
 * profiles.locale sync (migration 055) mirrors useAppearance()'s
 * write-through: best-effort, logged on failure, never blocks the
 * switch that already happened via the cookie.
 */
export function useLocalePreference() {
  const locale = useLocale() as LocaleId;
  const { profile } = useAuth();
  const router = useRouter();
  const t = useTranslations("Settings.appearance");
  const profileId = profile?.id ?? null;

  const setLocale = useCallback(
    async (next: LocaleId) => {
      if (next === locale) return;

      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => null);

      if (!res || !res.ok) {
        toast.error(t("switchFailed"));
        return;
      }

      if (profileId) {
        void createClient()
          .from("profiles")
          .update({ locale: next })
          .eq("id", profileId)
          .then(({ error }) => {
            if (error) {
              console.error("[useLocalePreference] persist failed:", error.message);
              toast.error(t("syncFailed"));
            }
          });
      }

      router.refresh();
    },
    [locale, profileId, router, t],
  );

  return { locale, setLocale };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-locale-preference.tsx messages/en.json
git commit -m "Add useLocalePreference hook and Appearance language strings"
```

---

## Task 6: `LocaleSync` component + wire into dashboard shell

**Files:**
- Create: `src/components/locale-sync.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 2, for `profile.locale`/`profile.id`), `useLocalePreference()` (Task 5), `isLocaleId` (Task 1).
- Produces: `<LocaleSync />` — headless, mounted once per authenticated session.

- [ ] **Step 1: Write the component**

```tsx
// src/components/locale-sync.tsx
"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useLocalePreference } from "@/hooks/use-locale-preference";
import { createClient } from "@/lib/supabase/client";
import { isLocaleId, type LocaleId } from "@/lib/locales";

/**
 * LocaleSync — reconciles the device-local locale (the wacrm.locale
 * cookie, via useLocalePreference()) with the one stored on the
 * user's profile row (migration 055). Headless. Sibling to
 * <ThemeSync>, same reconcile-once-per-profile shape.
 *
 * - profile has a valid saved locale that differs from this device's
 *   → apply it (DB is the cross-device source of truth on a fresh
 *   device).
 * - profile has none (or an id no longer in LOCALE_IDS) → back-fill
 *   it from whatever this device is currently showing.
 */
export function LocaleSync() {
  const { profile, profileLoading } = useAuth();
  const { locale, setLocale } = useLocalePreference();

  const syncedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (profileLoading || !profile) return;
    if (syncedForRef.current === profile.id) return;
    syncedForRef.current = profile.id;

    const savedLocale = profile.locale;
    const localeValid = isLocaleId(savedLocale);

    if (localeValid && savedLocale !== locale) {
      void setLocale(savedLocale as LocaleId);
      return;
    }

    if (localeValid) return;

    void createClient()
      .from("profiles")
      .update({ locale })
      .eq("id", profile.id)
      .then(({ error }) => {
        if (error) {
          console.error("[LocaleSync] backfill failed:", error.message);
        }
      });
  }, [profile, profileLoading, locale, setLocale]);

  return null;
}
```

- [ ] **Step 2: Mount it in the dashboard shell**

In `src/app/(dashboard)/dashboard-shell.tsx`, add the import next to `ThemeSync`:

```ts
import { ThemeSync } from "@/components/theme-sync";
import { LocaleSync } from "@/components/locale-sync";
```

And render it next to `<ThemeSync />`:

```tsx
      {/* Pulls the saved accent/mode off the profile row on sign-in and
          back-fills it from this device when unset. Headless. */}
      <ThemeSync />
      {/* Same reconcile-on-login pattern, for the UI language. Headless. */}
      <LocaleSync />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/locale-sync.tsx "src/app/(dashboard)/dashboard-shell.tsx"
git commit -m "Add LocaleSync and mount it in the dashboard shell"
```

---

## Task 7: `dir` attribute on `<html>`

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `localeDir` from `src/lib/locales.ts` (Task 1).

- [ ] **Step 1: Compute and apply `dir`**

In `src/app/layout.tsx`, add the import:

```ts
import { localeDir } from "@/lib/locales";
```

In `RootLayout`, after `const locale = await getLocale();`, add:

```ts
  const locale = await getLocale();
  const dir = localeDir(locale);
  const messages = await getMessages();
```

And add `dir={dir}` to the `<html>` element, next to `lang={locale}`:

```tsx
    <html
      lang={locale}
      dir={dir}
      data-theme={DEFAULT_THEME}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 3: Manual check**

Run: `npm run dev`, visit the app with no `wacrm.locale` cookie set (default `en`) and confirm `<html dir="ltr">` in devtools. This locale can't actually resolve to `ar` yet (no switcher UI, no `ar.json` — those land in Tasks 8 and 12+), so this step only confirms the `ltr` default renders without error.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "Set <html dir> from the resolved locale"
```

---

## Task 8: Language control in Settings → Appearance

**Files:**
- Modify: `src/components/settings/appearance-panel.tsx`

**Interfaces:**
- Consumes: `useLocalePreference()` (Task 5), `LOCALES` (Task 1).

- [ ] **Step 1: Add the Language section**

In `src/components/settings/appearance-panel.tsx`, update the imports to:

```tsx
import { Check, Languages, Moon, Palette, SunMoon, Sun } from "lucide-react";

import { useAppearance } from "@/hooks/use-appearance";
import { useLocalePreference } from "@/hooks/use-locale-preference";
import { LOCALES, type LocaleId } from "@/lib/locales";
import { MODES, THEMES, type Mode, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";
```

In the component body, read the hook alongside `useAppearance()`:

```tsx
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useAppearance();
  const { locale, setLocale } = useLocalePreference();
  const t = useTranslations("Settings.appearance");
```

Add a third section after the accent-color `<div>` (after its closing `</div>`, before the closing `</section>`):

```tsx
      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Languages className="size-4 text-muted-foreground" />
          {t("language")}
        </h3>

        <div
          role="radiogroup"
          aria-label="Language"
          className="grid max-w-md grid-cols-2 gap-3"
        >
          {LOCALES.map((l) => (
            <LanguageCard
              key={l.id}
              id={l.id}
              name={l.name}
              isActive={l.id === locale}
              onPick={() => setLocale(l.id)}
            />
          ))}
        </div>
      </div>
```

Add the `LanguageCard` component at the bottom of the file, next to `ModeCard`/`ThemeCard`:

```tsx
function LanguageCard({
  id,
  name,
  isActive,
  onPick,
}: {
  id: LocaleId;
  name: string;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("Settings.appearance");
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={t("useLanguage", { name })}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-start transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <span className="flex-1 text-sm font-semibold text-foreground">
        {name}
      </span>
      {isActive && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Check className="h-3 w-3" />
          {t("active")}
        </span>
      )}
    </button>
  );
}
```

(`text-start` here — not `text-left` — is the one directional class this new code introduces, written logical from the start per the Global Constraints.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 3: Manual check**

Run: `npm run dev`, open Settings → Appearance, confirm a "Language" section renders with an "English" card marked active. Clicking "العربية" will 400 from `/api/locale` until Task 12 adds `messages/ar.json` — that's expected at this point in the plan; full click-through verification happens after Task 12.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/appearance-panel.tsx
git commit -m "Add language picker to Settings → Appearance"
```

---

## Task 9: Fix hardcoded locale in `message-actions.tsx`

**Files:**
- Modify: `src/components/inbox/message-actions.tsx`

- [ ] **Step 1: Replace the module-level env read with `useLocale()`**

Remove these two lines (currently at the top of the file, after the imports):

```ts
// No per-agent locale exists — default the target language to whichever
// of the app's two shipped UI locales ISN'T the build-time default, and
// let the agent override it in the popover.
const APP_LOCALE = process.env.NEXT_PUBLIC_APP_LOCALE || "en";
const DEFAULT_TARGET_LANGUAGE = APP_LOCALE === "ko" ? "English" : "Korean";
```

Change the import:

```ts
import { useLocale, useTranslations } from "next-intl";
```

Inside `MessageActions`, right after `const t = useTranslations("Inbox.actions");`, add:

```tsx
  const locale = useLocale();

  // No per-agent locale exists — default the target language to
  // whichever of the app's two shipped UI locales ISN'T the current
  // one, and let the agent override it in the popover.
  const defaultTargetLanguage = locale === "ar" ? "English" : "Arabic";
```

Change the `useState` initializer:

```tsx
  const [targetLanguage, setTargetLanguage] = useState(defaultTargetLanguage);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inbox/message-actions.tsx
git commit -m "Read current locale for quick-translate default, drop ko reference"
```

---

## Task 10: Fix hardcoded locale in `message-composer.tsx`

**Files:**
- Modify: `src/components/inbox/message-composer.tsx`

- [ ] **Step 1: Replace the env read with `useLocale()`**

Change the import:

```ts
import { useLocale, useTranslations } from "next-intl";
```

Inside `MessageComposer`, right after `const t = useTranslations("Inbox.composer");`, add:

```tsx
  const locale = useLocale();
```

In `handleTranslateDraft`, replace:

```ts
    const appLocale = process.env.NEXT_PUBLIC_APP_LOCALE || "en";
    const targetLanguage = appLocale === "ko" ? "English" : "Korean";
```

with:

```ts
    const targetLanguage = locale === "ar" ? "English" : "Arabic";
```

Add `locale` to `handleTranslateDraft`'s `useCallback` dependency array (currently `[drafting, conversationId, adjustHeight]` → `[drafting, conversationId, adjustHeight, locale]`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inbox/message-composer.tsx
git commit -m "Read current locale for draft-translate target, drop ko reference"
```

---

## Task 11: Update `.env.local.example`

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Update the comment**

Change:

```
# Default language locale (e.g. en)
NEXT_PUBLIC_APP_LOCALE=en
```

to:

```
# Org-wide default language locale (e.g. en, ar). Used only when a
# visitor has no wacrm.locale cookie yet (first visit / signed-out
# device) — signed-in users can switch language from
# Settings -> Appearance, which persists per-user (profiles.locale)
# and overrides this default via a cookie.
NEXT_PUBLIC_APP_LOCALE=en
```

- [ ] **Step 2: Commit**

```bash
git add .env.local.example
git commit -m "Clarify NEXT_PUBLIC_APP_LOCALE is now just a default"
```

---

## Task 12: `ar.json` bootstrap + parity test + delete `ko.json`

**Files:**
- Create: `messages/ar.json`
- Delete: `messages/ko.json`
- Test: `messages/locale-parity.test.ts`

**Interfaces:**
- Produces: `messages/locale-parity.test.ts` — the automated check every later translation task (13–23) must keep passing.

- [ ] **Step 1: Write the parity test**

```ts
// messages/locale-parity.test.ts
import { describe, expect, it } from "vitest";
import en from "./en.json";
import ar from "./ar.json";

type Messages = { [key: string]: string | Messages };

function collectPaths(obj: Messages, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : collectPaths(value, path);
  });
}

function getAt(obj: Messages, path: string): string {
  const value = path.split(".").reduce<Messages | string>((acc, key) => {
    if (typeof acc === "string") throw new Error(`${path} is not an object at ${key}`);
    return acc[key];
  }, obj);
  if (typeof value !== "string") throw new Error(`${path} did not resolve to a string`);
  return value;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();
}

describe("messages/ar.json structural parity with en.json", () => {
  const enPaths = collectPaths(en as Messages).sort();
  const arPaths = collectPaths(ar as Messages).sort();

  it("has exactly the same set of keys as en.json", () => {
    expect(arPaths).toEqual(enPaths);
  });

  it("preserves every {placeholder} token at each shared key", () => {
    const mismatches = enPaths
      .filter((path) => arPaths.includes(path))
      .map((path) => ({
        path,
        en: placeholders(getAt(en as Messages, path)),
        ar: placeholders(getAt(ar as Messages, path)),
      }))
      .filter(({ en, ar }) => JSON.stringify(en) !== JSON.stringify(ar));

    expect(mismatches).toEqual([]);
  });
});
```

- [ ] **Step 2: Bootstrap `ar.json` and remove `ko.json`**

```bash
cp messages/en.json messages/ar.json
git rm messages/ko.json
```

(`ar.json` is a byte-for-byte copy of `en.json` at this point — still English text. Tasks 13–23 translate it namespace by namespace. The parity test passes immediately because the key structure and placeholders are, by construction, identical.)

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add messages/ar.json messages/locale-parity.test.ts
git commit -m "Bootstrap ar.json from en.json, remove ko.json, add parity test"
```

---

## Task 13: Translate `LoginPage`, `Sidebar`, `Header`, `ModeToggle` (53 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

In `messages/ar.json`, translate every string value under the top-level `LoginPage`, `Sidebar`, `Header`, and `ModeToggle` keys into Arabic, per the Global Constraints (preserve every `{placeholder}` token exactly; keep WhatsApp/API/CRM/brand names in Latin script; MSA business tone). Read the current English value of each key from `messages/en.json` at the same path before translating it — do not paraphrase from memory. Leave every other top-level namespace in `ar.json` untouched (still English, translated in later tasks).

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS — translating values in place doesn't change keys or placeholders, so this should already pass; it's a regression guard in case a key was accidentally added/removed/renamed during editing.

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate LoginPage/Sidebar/Header/ModeToggle to Arabic"
```

---

## Task 14: Translate `Dashboard`, `CustomFieldGroups` (83 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Dashboard` and `CustomFieldGroups` keys.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Dashboard/CustomFieldGroups to Arabic"
```

---

## Task 15: Translate `Contacts` (161 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Contacts` key.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Contacts to Arabic"
```

---

## Task 16: Translate `Inbox` (148 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Inbox` key.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Inbox to Arabic"
```

---

## Task 17: Translate `Pipelines` (115 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Pipelines` key.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Pipelines to Arabic"
```

---

## Task 18: Translate `Broadcasts` (150 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Broadcasts` key.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Broadcasts to Arabic"
```

---

## Task 19: Translate `Automations` (153 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Automations` key.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Automations to Arabic"
```

---

## Task 20: Translate `Flows` (180 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for the top-level `Flows` key.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Flows to Arabic"
```

---

## Task 21: Translate `Settings` part 1 — overview/members/invite/tagsAndFields/roles/sections/groups/profile/appearance/security/deals (199 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for these keys under the top-level `Settings` object: `pageTitle`, `pageDesc`, `overview`, `members`, `invite`, `tagsAndFields`, `roles`, `sections`, `groups`, `profile`, `appearance`, `security`, `deals`. Leave `templates`, `whatsapp`, `apiKeys`, `waha`, `aiConfig`, `aiKnowledge` untouched (translated in Tasks 22–23).

Note: `Settings.appearance` includes the three keys added in Task 5 (`language`, `useLanguage`, `switchFailed`) — translate those too.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Settings (overview/members/invite/fields/roles/profile/appearance/security/deals) to Arabic"
```

---

## Task 22: Translate `Settings` part 2 — templates/whatsapp/apiKeys/waha (218 keys)

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for `Settings.templates`, `Settings.whatsapp`, `Settings.apiKeys`, `Settings.waha`.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Settings (templates/whatsapp/apiKeys/waha) to Arabic"
```

---

## Task 23: Translate `Settings` part 3 — aiConfig/aiKnowledge (103 keys); full-file verification

**Files:**
- Modify: `messages/ar.json`

- [ ] **Step 1: Translate**

Same process as Task 13, for `Settings.aiConfig` and `Settings.aiKnowledge`. This is the last untranslated content — after this step every leaf in `ar.json` should be Arabic.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Full-suite check**

Run: `npx vitest run`
Expected: PASS — every test in the repo, not just the locale ones (translation edits shouldn't touch any test file, but this catches an accidental JSON syntax error breaking module resolution elsewhere).

- [ ] **Step 4: Manual check**

Run: `npm run dev`. In Settings → Appearance, click "العربية" and confirm: the switch applies without reload (per Task 8's `router.refresh()`), `<html lang="ar" dir="rtl">` in devtools, and spot-check 3–4 screens (Dashboard, Inbox, Settings, Contacts) for garbled/missing text (a literal `key.path` string rendering means a key is missing — shouldn't happen given the parity test, but worth eyeballing).

- [ ] **Step 5: Commit**

```bash
git add messages/ar.json
git commit -m "Translate Settings (aiConfig/aiKnowledge) to Arabic — ar.json complete"
```

---

## Task 24: RTL — app shell (sidebar, header)

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/header.tsx`

- [ ] **Step 1: Convert directional classes**

In `src/components/layout/sidebar.tsx` line 217, change:

```
"fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
```

to:

```
"fixed inset-y-0 start-0 z-40 flex h-full w-64 flex-col border-e border-border bg-card",
```

(`border-r` → `border-e`: this is the sidebar's outer edge against the main content, which is the *end* side of the sidebar regardless of direction.)

Line 362, change:

```
className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
```

to:

```
className={`ms-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
```

In `src/components/layout/header.tsx` line 86, change:

```
className="flex items-center gap-2 rounded-md px-1 py-1 outline-none transition-colors hover:bg-muted/70 focus:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3"
```

to:

```
className="flex items-center gap-2 rounded-md px-1 py-1 outline-none transition-colors hover:bg-muted/70 focus:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/70 sm:gap-3 sm:ps-1 sm:pe-3"
```

- [ ] **Step 2: Verify no directional utilities remain in these two files**

Run: `grep -noE '\b(pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-[a-zA-Z0-9\[\]/.]*' src/components/layout/sidebar.tsx src/components/layout/header.tsx`
Expected: no output.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: Manual check**

Run: `npm run dev`, switch to Arabic (Settings → Appearance), confirm the sidebar sits on the right edge of the viewport and the header's popover-trigger padding reads correctly (no visually cramped/overlapping icon+label).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/header.tsx
git commit -m "RTL: convert app-shell directional classes to logical properties"
```

---

## Task 25: RTL — inbox (conversation list, thread, composer, actions, reply quote, contact sidebar)

**Files:**
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-actions.tsx`
- Modify: `src/components/inbox/reply-quote.tsx`
- Modify: `src/components/inbox/contact-sidebar.tsx`

- [ ] **Step 1: `conversation-list.tsx`**

Line 278: `<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />` → `<Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />`

Line 283: `className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"` → `className="border-border bg-muted ps-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"`

Line 588: `isActive && "border-l-2 border-primary bg-muted/70"` → `isActive && "border-s-2 border-primary bg-muted/70"`

- [ ] **Step 2: `message-thread.tsx`**

Line 915: `"ml-1 hidden gap-1 border-border text-[10px] sm:inline-flex sm:ml-2",` → `"ms-1 hidden gap-1 border-border text-[10px] sm:inline-flex sm:ms-2",`

Line 1039: `className="mr-2"` → `className="me-2"`

Line 1045: `{isSelected && <Check className="ml-2 h-3 w-3" />}` → `{isSelected && <Check className="ms-2 h-3 w-3" />}`

- [ ] **Step 3: `message-composer.tsx`**

Every one of these `mr-*` instances is icon-before-label spacing inside a button/row and converts the same way — `mr-N` → `me-N`:

- Line 634: `<LayoutTemplate className="mr-1 h-3 w-3" />` → `<LayoutTemplate className="me-1 h-3 w-3" />`
- Line 728: `<ImageIcon className="mr-2 h-4 w-4" />` → `<ImageIcon className="me-2 h-4 w-4" />`
- Line 732: `<Video className="mr-2 h-4 w-4" />` → `<Video className="me-2 h-4 w-4" />`
- Line 736: `<FileText className="mr-2 h-4 w-4" />` → `<FileText className="me-2 h-4 w-4" />`
- Line 740: `<Mic className="mr-2 h-4 w-4" />` → `<Mic className="me-2 h-4 w-4" />`
- Line 744: `<LayoutGrid className="mr-2 h-4 w-4" />` → `<LayoutGrid className="me-2 h-4 w-4" />`
- Line 768: `<MessageSquareDashed className="mr-2 h-4 w-4" />` → `<MessageSquareDashed className="me-2 h-4 w-4" />`
- Line 772: `<Zap className="mr-2 h-4 w-4" />` → `<Zap className="me-2 h-4 w-4" />`
- Line 889: `<Loader2 className="mr-1 h-4 w-4 animate-spin" />` → `<Loader2 className="me-1 h-4 w-4 animate-spin" />`
- Line 891: `<Zap className="mr-1 h-4 w-4" />` → `<Zap className="me-1 h-4 w-4" />`
- Line 896: `<Send className="mr-1 h-4 w-4" />` → `<Send className="me-1 h-4 w-4" />`

Line 865: `<p className="mt-1 pl-[5.5rem] text-[10px] text-muted-foreground">` → `<p className="mt-1 ps-[5.5rem] text-[10px] text-muted-foreground">`

Line 1002: `draft.kind === "audio" && "ml-auto",` → `draft.kind === "audio" && "ms-auto",`

- [ ] **Step 4: `message-bubble.tsx`**

Line 313: `? "rounded-br-md bg-primary text-primary-foreground"` → `? "rounded-ee-md bg-primary text-primary-foreground"`

Line 314: `: "rounded-bl-md bg-muted text-foreground",` → `: "rounded-es-md bg-muted text-foreground",`

(`rounded-ee-*` = bottom-right in LTR / bottom-left in RTL; `rounded-es-*` = bottom-left in LTR / bottom-right in RTL — this keeps the own-message "tail corner" on the same visual side as the bubble itself, which flips via `justify-end`/`justify-start` — already logical in flexbox, no change needed there.)

- [ ] **Step 5: `message-actions.tsx`**

Line 150: `isAgent ? "right-3" : "left-3",` → `isAgent ? "end-3" : "start-3",`

- [ ] **Step 6: `reply-quote.tsx`**

Line 35: `"flex items-start gap-2 border-l-2 px-2 py-1",` → `"flex items-start gap-2 border-s-2 px-2 py-1",`

- [ ] **Step 7: `contact-sidebar.tsx`**

Line 247: `className="group inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[10px] font-medium"` → `className="group inline-flex items-center gap-1 rounded-full py-0.5 ps-2 pe-1 text-[10px] font-medium"`

- [ ] **Step 8: Verify no directional utilities remain**

Run: `grep -noE '\b(pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-left|text-right)-[a-zA-Z0-9\[\]/.]*' src/components/inbox/conversation-list.tsx src/components/inbox/message-thread.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-bubble.tsx src/components/inbox/message-actions.tsx src/components/inbox/reply-quote.tsx src/components/inbox/contact-sidebar.tsx`
Expected: no output.

- [ ] **Step 9: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 10: Manual check**

Run: `npm run dev`, switch to Arabic, open Inbox. Confirm: search icon and input padding sit on the right, the active conversation's accent border is on the right edge, message bubbles from "me" show their tail on the bottom-left, message action icons (search/reply/select) don't overlap text, and the composer's toolbar icons keep their spacing from labels.

- [ ] **Step 11: Commit**

```bash
git add src/components/inbox/conversation-list.tsx src/components/inbox/message-thread.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-bubble.tsx src/components/inbox/message-actions.tsx src/components/inbox/reply-quote.tsx src/components/inbox/contact-sidebar.tsx
git commit -m "RTL: convert inbox directional classes to logical properties"
```

---

## Task 26: RTL — Settings panels

**Files:**
- Modify: `src/components/settings/ai-config.tsx`
- Modify: `src/components/settings/ai-knowledge.tsx`
- Modify: `src/components/settings/ai-media-library.tsx`
- Modify: `src/components/settings/custom-field-groups-panel.tsx`
- Modify: `src/components/settings/quick-replies-manager.tsx`
- Modify: `src/components/settings/tag-manager.tsx`
- Modify: `src/components/settings/template-manager.tsx`
- Modify: `src/components/settings/waha-config.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx`

- [ ] **Step 1: `ai-config.tsx`**

All seven instances are `mr-2` on an icon immediately before text (loading spinners, a checkmark, a trash icon) or an `absolute right-2` on a show/hide-password button — convert each in place:

- Line 277: `<Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} ...` → `<Loader2 className="me-2 h-4 w-4 animate-spin" /> {t('loadFailed')} ...`
- Line 388: `className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"` → `className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"`
- Line 404: `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` → `<Loader2 className="me-2 h-4 w-4 animate-spin" />`
- Line 406: `<CheckCircle2 className="mr-2 h-4 w-4" />` → `<CheckCircle2 className="me-2 h-4 w-4" />`
- Line 682: `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` → `<Loader2 className="me-2 h-4 w-4 animate-spin" />`
- Line 684: `<Trash2 className="mr-2 h-4 w-4" />` → `<Trash2 className="me-2 h-4 w-4" />`
- Line 693: `{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}` → `{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}`

- [ ] **Step 2: `ai-knowledge.tsx`**

- Line 175: `<Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}` → `<Loader2 className="me-2 h-4 w-4 animate-spin" /> {t('loading')}`
- Line 250: `{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}` → `{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}`
- Line 259: `<Plus className="mr-2 h-4 w-4" /> {t('addDoc')}` → `<Plus className="me-2 h-4 w-4" /> {t('addDoc')}`
- Line 270: `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` → `<Loader2 className="me-2 h-4 w-4 animate-spin" />`
- Line 272: `<RefreshCw className="mr-2 h-4 w-4" />` → `<RefreshCw className="me-2 h-4 w-4" />`

- [ ] **Step 3: `ai-media-library.tsx`**

- Line 236: `<Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...` → `<Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading...`
- Line 406: `{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}` → `{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}`
- Line 414: `<Plus className="mr-2 h-4 w-4" /> Add media item` → `<Plus className="me-2 h-4 w-4" /> Add media item`

- [ ] **Step 4: `custom-field-groups-panel.tsx`**

- Line 520: `<div className="space-y-2 border-t border-border/60 p-2 pl-8">` → `<div className="space-y-2 border-t border-border/60 p-2 ps-8">`
- Line 657: `className="ml-auto shrink-0 text-muted-foreground hover:text-red-400"` → `className="ms-auto shrink-0 text-muted-foreground hover:text-red-400"`

- [ ] **Step 5: `quick-replies-manager.tsx`**

- Line 133: `<Plus className="mr-1 h-4 w-4" />` → `<Plus className="me-1 h-4 w-4" />`
- Line 233: `{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}` → `{saving && <Loader2 className="me-1 h-4 w-4 animate-spin" />}`

- [ ] **Step 6: `tag-manager.tsx`**

- Line 192: `className="ml-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"` → `className="ms-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"`

- [ ] **Step 7: `template-manager.tsx`**

- Line 573: `<div className="flex items-center gap-1 shrink-0 ml-2">` → `<div className="flex items-center gap-1 shrink-0 ms-2">`
- Line 1008: `<div className="space-y-1 pl-1">` → `<div className="space-y-1 ps-1">`

- [ ] **Step 8: `waha-config.tsx`**

- Line 203: `className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"` → `className="bg-muted border-border text-foreground placeholder:text-muted-foreground pe-10"`
- Line 208: `className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"` → `className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"`

- [ ] **Step 9: `whatsapp-config.tsx`**

- Line 603: `className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"` → `className="bg-muted border-border text-foreground placeholder:text-muted-foreground pe-10"`
- Line 608: `className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"` → `className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"`
- Line 636: `<span className="ml-1 text-muted-foreground">{t('optional')}</span>` → `<span className="ms-1 text-muted-foreground">{t('optional')}</span>`

- [ ] **Step 10: Verify no directional utilities remain**

Run: `grep -noE '\b(pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-[a-zA-Z0-9\[\]/.]*' src/components/settings/ai-config.tsx src/components/settings/ai-knowledge.tsx src/components/settings/ai-media-library.tsx src/components/settings/custom-field-groups-panel.tsx src/components/settings/quick-replies-manager.tsx src/components/settings/tag-manager.tsx src/components/settings/template-manager.tsx src/components/settings/waha-config.tsx src/components/settings/whatsapp-config.tsx`
Expected: no output.

- [ ] **Step 11: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 12: Manual check**

Run: `npm run dev`, switch to Arabic, open Settings and click through AI Assistant, AI Knowledge, Media Library, Fields & Tags, Quick Replies, Templates, WhatsApp, and WAHA panels. Confirm show/hide-password icons sit on the left edge of their input, and icon+label spacing in buttons still reads as a single unit (no icon jammed against its label).

- [ ] **Step 13: Commit**

```bash
git add src/components/settings/ai-config.tsx src/components/settings/ai-knowledge.tsx src/components/settings/ai-media-library.tsx src/components/settings/custom-field-groups-panel.tsx src/components/settings/quick-replies-manager.tsx src/components/settings/tag-manager.tsx src/components/settings/template-manager.tsx src/components/settings/waha-config.tsx src/components/settings/whatsapp-config.tsx
git commit -m "RTL: convert Settings-panel directional classes to logical properties"
```

---

## Task 27: RTL — broadcast wizard; audit contact form

**Files:**
- Modify: `src/components/broadcasts/step2-select-audience.tsx`
- Modify: `src/components/broadcasts/step3-personalize.tsx`
- Audit only (no change expected): `src/components/contacts/contact-form.tsx`, `src/components/broadcasts/step1-choose-template.tsx`, `src/components/broadcasts/step4-schedule-send.tsx`

- [ ] **Step 1: `step2-select-audience.tsx`**

- Line 363: `className="mr-1.5 h-2 w-2 rounded-full"` → `className="me-1.5 h-2 w-2 rounded-full"`
- Line 450: `className="mr-1.5 h-2 w-2 rounded-full"` → `className="me-1.5 h-2 w-2 rounded-full"`

- [ ] **Step 2: `step3-personalize.tsx`**

- Line 415: `<div className="ml-auto max-w-[85%] rounded-lg bg-primary/30 px-3 py-2 shadow-sm">` → `<div className="ms-auto max-w-[85%] rounded-lg bg-primary/30 px-3 py-2 shadow-sm">`

- [ ] **Step 3: Confirm the audit-only files need no change**

Run: `grep -noE '\b(pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-[a-zA-Z0-9\[\]/.]*' src/components/contacts/contact-form.tsx src/components/broadcasts/step1-choose-template.tsx src/components/broadcasts/step4-schedule-send.tsx`
Expected: no output (confirmed at spec time — these three files use no physical-direction Tailwind utilities, so `dir="rtl"` plus already-logical flexbox alignment is enough for them).

- [ ] **Step 4: Verify no directional utilities remain in the two modified files**

Run: `grep -noE '\b(pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-[a-zA-Z0-9\[\]/.]*' src/components/broadcasts/step2-select-audience.tsx src/components/broadcasts/step3-personalize.tsx`
Expected: no output.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Manual check**

Run: `npm run dev`, switch to Arabic, walk through New Broadcast: audience-selection status dots keep their spacing from the audience name, and the personalize-step message preview bubble aligns to the left (mirroring the inbox's own-message alignment).

- [ ] **Step 7: Commit**

```bash
git add src/components/broadcasts/step2-select-audience.tsx src/components/broadcasts/step3-personalize.tsx
git commit -m "RTL: convert broadcast-wizard directional classes to logical properties"
```

---

## Final verification

- [ ] Run the full test suite: `npx vitest run` — expect all green.
- [ ] Run `npm run typecheck` and `npm run lint` — expect clean.
- [ ] Run `npm run build` — confirms the `messages/ar.json` dynamic import in `src/i18n/request.ts` resolves at build time and nothing in the RTL edits broke a production build.
- [ ] Manual pass in the browser (`npm run dev`): switch English → Arabic → English from Settings → Appearance without a full reload each time; sign out and back in on the same browser and confirm the last-picked language is remembered (cookie survives); confirm `messages/ko.json` is gone and nothing in the app references `"ko"` as a locale (`grep -rn '"ko"' src messages` returns nothing locale-related).
