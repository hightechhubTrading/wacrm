import { describe, expect, it } from "vitest";
import en from "./en.json";
import ar from "./ar.json";
import { DEFAULT_LOCALE, LOCALE_IDS, type LocaleId } from "@/lib/locales";

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

/**
 * Extract top-level {..} groups from a message string using brace-depth tracking.
 * Returns the raw group content (without outer braces).
 */
function extractTopLevelGroups(value: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let current = "";
  let inGroup = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (char === "{") {
      if (depth === 0) inGroup = true;
      if (inGroup) current += char;
      depth++;
    } else if (char === "}") {
      depth--;
      if (inGroup) current += char;
      if (depth === 0 && inGroup) {
        groups.push(current.slice(1, -1)); // Remove outer braces
        current = "";
        inGroup = false;
      }
    } else if (inGroup) {
      current += char;
    }
  }

  return groups;
}

/**
 * Compute a signature for a top-level group that allows translation of content.
 * - Simple interpolation (no comma): return the whole token as-is (e.g., "{count}")
 * - ICU plural/select/selectordinal: return "argName:type:[category keywords]"
 *   The category keywords are sorted and joined so order doesn't matter.
 */
// Matches the "argName, type," header of an ICU plural/select/
// selectordinal construct — e.g. "count, plural," or "count,plural,"
// (no space) or "count ,  plural ,". Whitespace-tolerant by design:
// slicing by a hardcoded offset (the previous approach) silently
// mis-parses as soon as a translator omits a space, e.g.
// "{count,plural, =1 {x} other {y}}" would shift the offset and
// truncate the first category keyword into the signature, producing
// a confusing false test failure instead of a clean parse.
const ICU_HEADER_RE = /^\s*(\S+)\s*,\s*(plural|select|selectordinal)\s*,/;

function groupSignature(groupContent: string): string {
  // Check if this is an ICU construct (contains a comma before the first brace)
  const commaIdx = groupContent.indexOf(",");
  if (commaIdx === -1) {
    // Simple interpolation: {name} or {count}
    return `{${groupContent}}`;
  }

  // ICU construct: {argName, type, ...}
  const headerMatch = groupContent.match(ICU_HEADER_RE);

  if (!headerMatch) {
    // Not a recognized ICU type; treat as simple interpolation
    return `{${groupContent}}`;
  }

  const [header, argName, typeKeyword] = headerMatch;

  // Extract category keywords. Each category appears as "keyword {content}" or "keyword{content}".
  // We need to extract only the keywords that appear *before* their opening braces.
  const remainder = groupContent.slice(header.length);

  const categories = new Set<string>();
  let braceDepth = 0;
  let currentKeyword = "";

  for (let i = 0; i < remainder.length; i++) {
    const char = remainder[i];

    if (char === "{") {
      if (currentKeyword.trim()) {
        categories.add(currentKeyword.trim());
      }
      currentKeyword = "";
      braceDepth++;
    } else if (char === "}") {
      braceDepth--;
    } else if (braceDepth === 0) {
      currentKeyword += char;
    }
  }

  // Build signature: argName:type:[sorted category keywords]
  const sortedCategories = Array.from(categories).sort().join("|");
  return `${argName}:${typeKeyword}:[${sortedCategories}]`;
}

/**
 * Extract and compute signatures for all placeholders in a message string.
 * Returns them sorted for deterministic comparison.
 */
function placeholderSignatures(value: string): string[] {
  const groups = extractTopLevelGroups(value);
  return groups.map(groupSignature).sort();
}

describe("messages/locale-parity placeholder parsing", () => {
  describe("unit tests: groupSignature and ICU parsing", () => {
    it("simple interpolation {name} must match exactly", () => {
      const en = "Hello {name}";
      const ar = "Hello {name}";
      expect(placeholderSignatures(en)).toEqual(placeholderSignatures(ar));
    });

    it("simple interpolation with different placeholder name must NOT match", () => {
      const en = "Hello {name}";
      const ar = "Hello {username}";
      expect(placeholderSignatures(en)).not.toEqual(placeholderSignatures(ar));
    });

    it("plural construct with only branch content differing must PASS", () => {
      const en = "{count, plural, =1 {conversation} other {conversations}}";
      const ar = "{count, plural, =1 {محادثة} other {محادثات}}";
      expect(placeholderSignatures(en)).toEqual(placeholderSignatures(ar));
    });

    it("category keywords must be extracted cleanly without stray commas or spaces", () => {
      const signature = placeholderSignatures("{count, plural, =1 {x} other {y}}");
      // Should be exactly ["count:plural:[=1|other]"], not ["count:plural:[, =1|other]"] or similar
      expect(signature).toEqual(["count:plural:[=1|other]"]);
    });

    it("handles an ICU header with no space after the first comma (count,plural,=1 {x} other {y})", () => {
      // A translator writing "{count,plural, =1 {x} other {y}}" (no
      // space after the first comma) used to shift a hardcoded offset
      // and truncate the first category keyword. The header is now
      // parsed with a regex, so this must resolve identically to the
      // fully-spaced form.
      const noSpace = placeholderSignatures("{count,plural,=1 {x} other {y}}");
      const spaced = placeholderSignatures("{count, plural, =1 {x} other {y}}");
      expect(noSpace).toEqual(["count:plural:[=1|other]"]);
      expect(noSpace).toEqual(spaced);
    });

    it("plural construct with missing category keyword must FAIL", () => {
      const en = "{count, plural, =1 {one} other {many}}";
      const ar = "{count, plural, =1 {واحد}}"; // Missing "other"
      expect(placeholderSignatures(en)).not.toEqual(placeholderSignatures(ar));
    });

    it("plural construct with different argName must FAIL", () => {
      const en = "{count, plural, =1 {x} other {y}}";
      const ar = "{total, plural, =1 {x} other {y}}";
      expect(placeholderSignatures(en)).not.toEqual(placeholderSignatures(ar));
    });

    it("plural vs select type mismatch must FAIL", () => {
      const en = "{status, plural, =1 {x} other {y}}";
      const ar = "{status, select, active {نشط} other {غير نشط}}";
      expect(placeholderSignatures(en)).not.toEqual(placeholderSignatures(ar));
    });

    it("multiple placeholders in one string are tracked independently", () => {
      const en = "You have {count, plural, =1 {message} other {messages}} from {sender}";
      const ar = "لديك {count, plural, =1 {رسالة} other {رسائل}} من {sender}";
      expect(placeholderSignatures(en)).toEqual(placeholderSignatures(ar));
    });
  });

  // Statically-imported messages for every non-default locale, keyed
  // by LocaleId. Adding a locale per src/lib/locales.ts's documented
  // three-step process (id -> LOCALE_IDS, meta -> LOCALES, file ->
  // messages/<id>.json) means step 3 also needs an entry registered
  // here — the test below throws a clear, actionable error rather
  // than silently skipping a locale that has no entry, so a forgotten
  // registration fails loudly instead of leaving that locale
  // unchecked.
  const LOCALE_MESSAGES: Partial<Record<LocaleId, Messages>> = {
    ar: ar as Messages,
  };

  const nonDefaultLocales = LOCALE_IDS.filter((id) => id !== DEFAULT_LOCALE);

  describe.each(nonDefaultLocales)(
    "messages/%s.json structural parity with en.json",
    (localeId) => {
      const messages = LOCALE_MESSAGES[localeId];

      if (!messages) {
        throw new Error(
          `locale-parity.test.ts has no registered messages for locale "${localeId}". ` +
            `Add \`import ${localeId} from "./${localeId}.json"\` and register it in LOCALE_MESSAGES.`,
        );
      }

      const enPaths = collectPaths(en as Messages).sort();
      const localePaths = collectPaths(messages).sort();

      it(`has exactly the same set of keys as en.json`, () => {
        expect(localePaths).toEqual(enPaths);
      });

      it(`preserves ICU structure (argName, type, category keywords) in all {..} groups`, () => {
        const mismatches = enPaths
          .filter((path) => localePaths.includes(path))
          .map((path) => ({
            path,
            en: placeholderSignatures(getAt(en as Messages, path)),
            [localeId]: placeholderSignatures(getAt(messages, path)),
          }))
          .filter(
            (entry) => JSON.stringify(entry.en) !== JSON.stringify(entry[localeId]),
          );

        expect(mismatches).toEqual([]);
      });
    },
  );
});
