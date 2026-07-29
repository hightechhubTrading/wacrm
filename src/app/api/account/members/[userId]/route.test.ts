// Tests for PATCH /api/account/members/[userId] — specifically the
// one-time WAHA webhook-URL reveal, which is the only place an admin ever
// sees the plaintext webhook secret. Two whole-branch review findings
// live here:
//
//   * the URL is minted on the FIRST call that lands a session name on a
//     member's row — in the natural registration order that's the
//     session-name save, not the phone save, so the session-name path
//     must return it;
//   * the base URL must be absolute even when NEXT_PUBLIC_SITE_URL is
//     unset (it previously produced a relative, useless URL, and the
//     secret is unrecoverable once the response is dropped).

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  profileRow: { data: null as Record<string, unknown> | null, error: null as unknown },
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
}));

import { PATCH } from './route';

function makeSupabase() {
  return {
    rpc: mocks.rpc,
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ['select', 'eq']) b[m] = vi.fn(chain);
      b.maybeSingle = vi.fn(() => Promise.resolve(mocks.profileRow));
      return b;
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://internal.local/api/account/members/user-2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ userId: 'user-2' }) };

const savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.requireRole.mockResolvedValue({
    supabase: makeSupabase(),
    accountId: 'acct-1',
    userId: 'user-1',
    role: 'admin',
    account: { id: 'acct-1', name: 'Acme' },
  });
  // A member with a session name already staged but NO secret yet — the
  // state right before the first mint.
  mocks.profileRow = {
    data: { waha_session_name: null, phone: null, waha_webhook_secret: null },
    error: null,
  };
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
});

describe('PATCH /api/account/members/[userId] — WAHA webhook URL', () => {
  it('returns the webhook_url on the session-name-only save (the first mint)', async () => {
    const res = await PATCH(request({ waha_session_name: 'sarah-agent' }), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(typeof payload.webhook_url).toBe('string');
    expect(payload.webhook_url).toContain('/api/waha/webhook/acct-1/sarah-agent?secret=');

    // The RPC got the ENCRYPTED secret; the plaintext only ever appears
    // in the URL we hand back this once.
    const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, string>;
    expect(rpcArgs.p_new_webhook_secret).toMatch(/^enc:/);
    const plaintext = new URL(payload.webhook_url).searchParams.get('secret');
    expect(rpcArgs.p_new_webhook_secret).toBe(`enc:${plaintext}`);
  });

  it('builds an ABSOLUTE webhook_url with NEXT_PUBLIC_SITE_URL unset', async () => {
    const res = await PATCH(
      request(
        { waha_session_name: 'sarah-agent' },
        { 'x-forwarded-host': 'crm.example.com', 'x-forwarded-proto': 'https' },
      ),
      params,
    );
    const payload = await res.json();

    // The regression this pins: the naive `?? ""` base produced
    // "/api/waha/webhook/…", which is useless to paste into WAHA and
    // unrecoverable because the secret is never shown again.
    expect(payload.webhook_url).toMatch(/^https:\/\/crm\.example\.com\//);
    expect(() => new URL(payload.webhook_url)).not.toThrow();
  });

  it('honours an explicit NEXT_PUBLIC_SITE_URL and strips its trailing slash', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com/';

    const res = await PATCH(request({ waha_session_name: 'sarah-agent' }), params);
    const payload = await res.json();

    expect(payload.webhook_url).toContain(
      'https://app.example.com/api/waha/webhook/acct-1/sarah-agent?secret=',
    );
  });

  it('does NOT re-mint (or re-reveal) once a secret already exists', async () => {
    mocks.profileRow = {
      data: {
        waha_session_name: 'sarah-agent',
        phone: null,
        waha_webhook_secret: 'enc:already-there',
      },
      error: null,
    };

    const res = await PATCH(request({ phone: '+19998887777' }), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.webhook_url).toBeUndefined();
    const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, string | null>;
    expect(rpcArgs.p_new_webhook_secret).toBeNull();
    expect(rpcArgs.p_phone).toBe('+19998887777');
  });

  it('mints nothing when the session name is being CLEARED', async () => {
    mocks.profileRow = {
      data: { waha_session_name: 'sarah-agent', phone: '+1999', waha_webhook_secret: null },
      error: null,
    };

    const res = await PATCH(request({ waha_session_name: null }), params);
    const payload = await res.json();

    expect(payload.webhook_url).toBeUndefined();
    const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, string | null>;
    expect(rpcArgs.p_session_name).toBe('');
    expect(rpcArgs.p_new_webhook_secret).toBeNull();
  });
});
