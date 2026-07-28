"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { createClient } from "@/lib/supabase/client";
import type { Mode, ThemeId } from "@/lib/themes";

/**
 * useAppearance — useTheme() plus write-through to the user's profile
 * row, so a pick made here follows them to their other devices
 * (migration 042).
 *
 * Every control that changes appearance should use this rather than
 * useTheme() directly; otherwise that control would update the device
 * but silently drift from the stored value. Two callers today: the
 * Settings → Appearance panel and the header ModeToggle.
 *
 * Ordering matters: apply locally FIRST, then persist. The local apply
 * is a single attribute swap on <html> and can't fail, so the UI stays
 * instant and a slow or failed network round-trip never blocks or
 * reverts what the user just saw. On failure we surface a toast and
 * keep the local choice — localStorage still has it, and the next pick
 * (or the ThemeSync back-fill on next sign-in) retries.
 *
 * No permission gate: these columns live on the caller's own profile
 * row, unlike account-wide settings such as default_currency.
 */
export function useAppearance() {
  const { theme, setTheme: applyTheme, mode, setMode: applyMode } = useTheme();
  const { profile } = useAuth();
  const t = useTranslations("Settings.appearance");
  const profileId = profile?.id ?? null;

  const persist = useCallback(
    (patch: { theme?: ThemeId; mode?: Mode }) => {
      // Signed out, or the profile row hasn't resolved yet. The choice
      // is still in localStorage; ThemeSync back-fills it on sign-in.
      if (!profileId) return;

      void createClient()
        .from("profiles")
        .update(patch)
        .eq("id", profileId)
        .then(({ error }) => {
          if (error) {
            console.error("[useAppearance] persist failed:", error.message);
            toast.error(t("syncFailed"));
          }
        });
    },
    [profileId, t],
  );

  const setTheme = useCallback(
    (next: ThemeId) => {
      applyTheme(next);
      persist({ theme: next });
    },
    [applyTheme, persist],
  );

  const setMode = useCallback(
    (next: Mode) => {
      applyMode(next);
      persist({ mode: next });
    },
    [applyMode, persist],
  );

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  return { theme, setTheme, mode, setMode, toggleMode };
}
