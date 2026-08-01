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
