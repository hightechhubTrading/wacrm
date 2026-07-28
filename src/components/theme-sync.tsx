"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { createClient } from "@/lib/supabase/client";
import { isMode, isThemeId } from "@/lib/themes";

/**
 * ThemeSync — reconciles the device-local appearance choice with the
 * one stored on the user's profile row (migration 042). Headless.
 *
 * Why a separate component instead of doing this inside ThemeProvider:
 * ThemeProvider lives in the ROOT layout (src/app/layout.tsx) so the
 * no-flash boot script and the provider agree on every route, including
 * unauthenticated ones. AuthProvider lives further down, in the
 * dashboard shell. That makes ThemeProvider an *ancestor* of
 * AuthProvider, so it can't call useAuth(). This bridge renders inside
 * both and talks to each via its hook.
 *
 * Reconciliation runs once per profile:
 *   - profile has a valid saved choice → apply it (the DB is the
 *     cross-device source of truth on a fresh device).
 *   - profile has none (or a value no longer in THEME_IDS) → back-fill
 *     it from whatever this device is currently showing. First device
 *     to sign in wins, and a theme that was later removed self-heals.
 *
 * setTheme/setMode already write both the <html> attribute and
 * localStorage, so applying a saved choice also primes the boot script
 * for subsequent loads on this device.
 *
 * Known, accepted gap: the boot script only reads localStorage, so on a
 * genuinely new device the first paint shows the default theme for a
 * frame before this effect swaps it. Closing that would mean reading
 * the profile row server-side in the root layout on every request —
 * not worth the latency for a one-frame cosmetic blip.
 */
export function ThemeSync() {
  const { profile, profileLoading } = useAuth();
  const { theme, setTheme, mode, setMode } = useTheme();

  // Which profile id we've already reconciled. Guards against re-running
  // when refreshProfile() refetches mid-session (e.g. after a profile
  // save) — without this, a stale row could stomp a pick the user just
  // made in Settings → Appearance.
  const syncedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (profileLoading || !profile) return;
    if (syncedForRef.current === profile.id) return;
    syncedForRef.current = profile.id;

    const savedTheme = profile.theme;
    const savedMode = profile.mode;

    // Anything the client can't validate counts as unset, so the
    // back-fill below repairs the row rather than leaving it broken.
    const themeValid = isThemeId(savedTheme);
    const modeValid = isMode(savedMode);

    if (themeValid && savedTheme !== theme) setTheme(savedTheme);
    if (modeValid && savedMode !== mode) setMode(savedMode);

    if (themeValid && modeValid) return;

    const patch: { theme?: string; mode?: string } = {};
    if (!themeValid) patch.theme = theme;
    if (!modeValid) patch.mode = mode;

    void createClient()
      .from("profiles")
      .update(patch)
      .eq("id", profile.id)
      .then(({ error }) => {
        if (error) {
          // Silent on purpose — this is opportunistic back-fill, not a
          // user-initiated save. The app is already showing the right
          // theme from localStorage; the next sign-in retries.
          console.error("[ThemeSync] backfill failed:", error.message);
        }
      });
  }, [profile, profileLoading, theme, setTheme, mode, setMode]);

  return null;
}
