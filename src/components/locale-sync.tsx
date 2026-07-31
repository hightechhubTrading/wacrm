"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useLocalePreference } from "@/hooks/use-locale-preference";
import { createClient } from "@/lib/supabase/client";
import { isLocaleId, type LocaleId } from "@/lib/locales";

/** Decision LocaleSync's effect acts on for a given render. */
export type LocaleSyncAction =
  | { kind: "none" }
  | { kind: "apply"; locale: LocaleId }
  | { kind: "backfill" };

/**
 * Reconcile-once state machine backing LocaleSync's effect, pulled out
 * as a pure factory so the "runs once per profile, not on every
 * re-render" guarantee and the apply-vs-backfill branch can be unit
 * tested without rendering React (see locale-sync.test.ts). Each
 * LocaleSync instance owns exactly one reconciler, created once via
 * useRef/useState in the component below.
 *
 * - profile has a valid saved locale that differs from this device's
 *   → apply it (DB is the cross-device source of truth on a fresh
 *   device).
 * - profile has none (or an id no longer in LOCALE_IDS) → back-fill
 *   it from whatever this device is currently showing.
 * - profile's saved locale already matches this device's → nothing
 *   to do.
 * - already reconciled for this profile id → nothing to do, even if
 *   inputs otherwise look actionable (guards re-renders, e.g. from
 *   refreshProfile() refetching mid-session).
 */
export function createLocaleReconciler() {
  let syncedFor: string | null = null;

  return function reconcile(input: {
    profileLoading: boolean;
    profileId: string | null;
    savedLocale: unknown;
    currentLocale: LocaleId;
  }): LocaleSyncAction {
    const { profileLoading, profileId, savedLocale, currentLocale } = input;

    if (profileLoading || !profileId) return { kind: "none" };
    if (syncedFor === profileId) return { kind: "none" };
    syncedFor = profileId;

    const localeValid = isLocaleId(savedLocale);

    if (localeValid && savedLocale !== currentLocale) {
      return { kind: "apply", locale: savedLocale as LocaleId };
    }

    if (localeValid) return { kind: "none" };

    return { kind: "backfill" };
  };
}

/**
 * LocaleSync — reconciles the device-local locale (the wacrm.locale
 * cookie, via useLocalePreference()) with the one stored on the
 * user's profile row (migration 055). Headless. Sibling to
 * <ThemeSync>, same reconcile-once-per-profile shape (see
 * createLocaleReconciler() above for the decision logic).
 */
export function LocaleSync() {
  const { profile, profileLoading } = useAuth();
  const { locale, setLocale } = useLocalePreference();

  // Lazy-init: one reconciler instance per LocaleSync mount, stable
  // across re-renders (the useState initializer only runs once).
  const [reconcile] = useState(() => createLocaleReconciler());

  useEffect(() => {
    const action = reconcile({
      profileLoading,
      profileId: profile?.id ?? null,
      savedLocale: profile?.locale,
      currentLocale: locale,
    });

    if (action.kind === "apply") {
      void setLocale(action.locale);
      return;
    }

    if (action.kind === "none") return;

    // action.kind === "backfill" — the reconciler only returns this
    // when profileId was non-null, so profile is guaranteed set here.
    if (!profile) return;

    void createClient()
      .from("profiles")
      .update({ locale })
      .eq("id", profile.id)
      .then(({ error }) => {
        if (error) {
          console.error("[LocaleSync] backfill failed:", error.message);
        }
      });
  }, [profile, profileLoading, locale, setLocale, reconcile]);

  return null;
}
