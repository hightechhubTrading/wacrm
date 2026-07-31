import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.set })),
}));

import { POST } from "./route";

function request(body: unknown, extraHeaders?: Record<string, string>) {
  return new Request("http://localhost/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.set.mockReset();
});

describe("POST /api/locale", () => {
  it("sets the locale cookie for a known locale", async () => {
    const res = await POST(request({ locale: "ar" }));
    expect(res.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(
      "wacrm.locale",
      "ar",
      expect.objectContaining({ path: "/" }),
    );
    const json = await res.json();
    expect(json).toEqual({ locale: "ar" });
  });

  it("rejects an unknown locale", async () => {
    const res = await POST(request({ locale: "ko" }));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rejects a missing locale", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rejects a cross-site request even with a known locale", async () => {
    const res = await POST(
      request({ locale: "ar" }, { "Sec-Fetch-Site": "cross-site" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("sets the cookie with secure: true in production", async () => {
    const original = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      await POST(request({ locale: "ar" }));
      expect(mocks.set).toHaveBeenCalledWith(
        "wacrm.locale",
        "ar",
        expect.objectContaining({ secure: true }),
      );
    } finally {
      vi.stubEnv("NODE_ENV", original ?? "test");
    }
  });
});
