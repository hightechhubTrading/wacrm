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
