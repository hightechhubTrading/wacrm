import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.set })),
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
});
