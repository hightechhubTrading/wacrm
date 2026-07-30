import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.get })),
}));

// Mock getRequestConfig to just pass through the config function
vi.mock("next-intl/server", () => ({
  getRequestConfig: (fn: () => Promise<any>) => fn,
}));

import requestConfig from "./request";

describe("i18n request config", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockReturnValue(undefined);
    delete process.env.NEXT_PUBLIC_APP_LOCALE;
  });

  it("uses the locale cookie when it's a known locale", async () => {
    mocks.get.mockReturnValue({ value: "ar" });
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("ar");
  });

  it("falls back to NEXT_PUBLIC_APP_LOCALE when the cookie is missing", async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = "ar";
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("ar");
  });

  it("falls back to en when neither the cookie nor the env var is set", async () => {
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("en");
  });

  it("ignores an invalid cookie value and falls back", async () => {
    mocks.get.mockReturnValue({ value: "ko" });
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("en");
  });

  it("loads the messages file matching the resolved locale", async () => {
    mocks.get.mockReturnValue({ value: "ar" });
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.messages).toBeDefined();
    expect((config.messages as Record<string, unknown>).LoginPage).toBeDefined();
  });
});
