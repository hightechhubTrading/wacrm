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
