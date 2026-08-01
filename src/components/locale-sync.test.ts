import { describe, expect, it } from "vitest";

import { createLocaleReconciler } from "./locale-sync";

/**
 * Unit tests for LocaleSync's reconcile decision, extracted as
 * createLocaleReconciler() precisely so this logic — the reviewer's
 * "single most likely failure mode in this design" — can be tested
 * without rendering React (this repo's vitest config runs in a plain
 * Node environment; no jsdom / @testing-library/react is installed).
 *
 * Each `reconcile` function returned by createLocaleReconciler() is
 * called multiple times in a row to simulate the effect re-running
 * across re-renders, the same way React would invoke it.
 */
describe("createLocaleReconciler", () => {
  it("applies the saved locale once when it differs from the device's, and does nothing on subsequent calls for the same profile", () => {
    const reconcile = createLocaleReconciler();

    const first = reconcile({
      profileLoading: false,
      profileId: "user-1",
      savedLocale: "ar",
      currentLocale: "en",
    });
    expect(first).toEqual({ kind: "apply", locale: "ar" });

    // Simulate a re-render with identical inputs (e.g. a parent
    // re-render, or refreshProfile() refetching the same row).
    const second = reconcile({
      profileLoading: false,
      profileId: "user-1",
      savedLocale: "ar",
      currentLocale: "en",
    });
    expect(second).toEqual({ kind: "none" });

    // Even if the device locale hasn't caught up yet by the next
    // render, we must not fire "apply" again for the same profile.
    const third = reconcile({
      profileLoading: false,
      profileId: "user-1",
      savedLocale: "ar",
      currentLocale: "en",
    });
    expect(third).toEqual({ kind: "none" });
  });

  it("backfills when the saved locale is null", () => {
    const reconcile = createLocaleReconciler();

    const action = reconcile({
      profileLoading: false,
      profileId: "user-2",
      savedLocale: null,
      currentLocale: "en",
    });
    expect(action).toEqual({ kind: "backfill" });
  });

  it("backfills when the saved locale is no longer a valid LocaleId", () => {
    const reconcile = createLocaleReconciler();

    const action = reconcile({
      profileLoading: false,
      profileId: "user-3",
      savedLocale: "ko", // removed locale, per the Korean->Arabic rollout
      currentLocale: "en",
    });
    expect(action).toEqual({ kind: "backfill" });
  });

  it("does nothing when the saved locale already matches the device's", () => {
    const reconcile = createLocaleReconciler();

    const first = reconcile({
      profileLoading: false,
      profileId: "user-4",
      savedLocale: "en",
      currentLocale: "en",
    });
    expect(first).toEqual({ kind: "none" });

    const second = reconcile({
      profileLoading: false,
      profileId: "user-4",
      savedLocale: "en",
      currentLocale: "en",
    });
    expect(second).toEqual({ kind: "none" });
  });

  it("does nothing while the profile is still loading, and does not consume the once-per-profile guard", () => {
    const reconcile = createLocaleReconciler();

    const loading = reconcile({
      profileLoading: true,
      profileId: null,
      savedLocale: undefined,
      currentLocale: "en",
    });
    expect(loading).toEqual({ kind: "none" });

    // Once loading finishes, the same profile should still be able to
    // reconcile normally — the guard must not have been "spent" while
    // loading was true.
    const loaded = reconcile({
      profileLoading: false,
      profileId: "user-5",
      savedLocale: "ar",
      currentLocale: "en",
    });
    expect(loaded).toEqual({ kind: "apply", locale: "ar" });
  });

  it("does nothing when there is no profile id", () => {
    const reconcile = createLocaleReconciler();

    const action = reconcile({
      profileLoading: false,
      profileId: null,
      savedLocale: "ar",
      currentLocale: "en",
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("reconciles independently per-profile-id (switching accounts on the same device)", () => {
    const reconcile = createLocaleReconciler();

    const forUserA = reconcile({
      profileLoading: false,
      profileId: "user-a",
      savedLocale: "ar",
      currentLocale: "en",
    });
    expect(forUserA).toEqual({ kind: "apply", locale: "ar" });

    // Different profile id -> guard should not block this one, even
    // though a reconcile already ran once on this reconciler instance.
    const forUserB = reconcile({
      profileLoading: false,
      profileId: "user-b",
      savedLocale: null,
      currentLocale: "ar",
    });
    expect(forUserB).toEqual({ kind: "backfill" });
  });
});
