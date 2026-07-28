import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  THEME_IDS,
  THEMES,
  isMode,
  isThemeId,
} from "./themes";

const globalsCss = readFileSync(
  join(__dirname, "../app/globals.css"),
  "utf8",
);

describe("isThemeId", () => {
  it("accepts every registered theme id", () => {
    for (const id of THEME_IDS) {
      expect(isThemeId(id)).toBe(true);
    }
  });

  it("rejects unknown and non-string values", () => {
    expect(isThemeId("navygold")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });
});

describe("isMode", () => {
  it("accepts every registered mode", () => {
    for (const m of MODES) {
      expect(isMode(m)).toBe(true);
    }
  });

  it("rejects unknown and non-string values", () => {
    expect(isMode("Dark")).toBe(false);
    expect(isMode(null)).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });
});

describe("theme catalog integrity", () => {
  it("defaults are themselves valid", () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
    expect(isMode(DEFAULT_MODE)).toBe(true);
  });

  it("THEMES covers exactly THEME_IDS, in the same order", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  it("every theme has display metadata", () => {
    for (const t of THEMES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.tagline.length).toBeGreaterThan(0);
      expect(t.swatch).toMatch(/^oklch\(/);
    }
  });
});

// The failure this guards against: registering an id here but
// forgetting the CSS block, which yields a picker card that silently
// falls through to the :root defaults instead of changing anything.
describe("globals.css wiring", () => {
  it("defines an accent block for every theme id", () => {
    for (const id of THEME_IDS) {
      expect(
        globalsCss.includes(`html[data-theme="${id}"]`),
        `missing html[data-theme="${id}"] block in globals.css`,
      ).toBe(true);
    }
  });

  it("defines a mode block for every mode", () => {
    for (const m of MODES) {
      expect(
        globalsCss.includes(`html[data-mode="${m}"]`),
        `missing html[data-mode="${m}"] block in globals.css`,
      ).toBe(true);
    }
  });

  // navy-gold is the one theme that also re-tints surfaces, so it
  // needs a paired block per mode — a missing one leaves that mode
  // showing the generic neutral ladder with a gold accent.
  it("navy-gold carries a surface block for both modes", () => {
    for (const m of MODES) {
      expect(
        globalsCss.includes(`html[data-theme="navy-gold"][data-mode="${m}"]`),
        `missing navy-gold surface block for ${m} mode`,
      ).toBe(true);
    }
  });
});
