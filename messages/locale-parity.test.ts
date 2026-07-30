import { describe, expect, it } from "vitest";
import en from "./en.json";
import ar from "./ar.json";

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

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();
}

describe("messages/ar.json structural parity with en.json", () => {
  const enPaths = collectPaths(en as Messages).sort();
  const arPaths = collectPaths(ar as Messages).sort();

  it("has exactly the same set of keys as en.json", () => {
    expect(arPaths).toEqual(enPaths);
  });

  it("preserves every {placeholder} token at each shared key", () => {
    const mismatches = enPaths
      .filter((path) => arPaths.includes(path))
      .map((path) => ({
        path,
        en: placeholders(getAt(en as Messages, path)),
        ar: placeholders(getAt(ar as Messages, path)),
      }))
      .filter(({ en, ar }) => JSON.stringify(en) !== JSON.stringify(ar));

    expect(mismatches).toEqual([]);
  });
});
