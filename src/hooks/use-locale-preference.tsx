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
