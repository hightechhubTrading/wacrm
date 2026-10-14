// Tests for PATCH /api/account/members/[userId] — the phone-number path,
// which forwards to the `set_member_phone` RPC.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
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

import { PATCH } from './route';

function request(body: unknown) {
  return new Request('http://internal.local/api/account/members/user-2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ userId: 'user-2' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.requireRole.mockResolvedValue({
    supabase: { rpc: mocks.rpc },
    accountId: 'acct-1',
    userId: 'user-1',
    role: 'admin',
    account: { id: 'acct-1', name: 'Acme' },
  });
});

describe('PATCH /api/account/members/[userId] — phone', () => {
  it('saves a trimmed phone number via set_member_phone', async () => {
    const res = await PATCH(request({ phone: '  +19998887777 ' }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('set_member_phone', {
      p_user_id: 'user-2',
      p_phone: '+19998887777',
    });
  });

  it('clears the phone number when null is sent', async () => {
    const res = await PATCH(request({ phone: null }), params);
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('set_member_phone', {
      p_user_id: 'user-2',
      p_phone: '',
    });
  });

  it('rejects a non-string phone', async () => {
    const res = await PATCH(request({ phone: 123 }), params);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a body with neither role nor phone', async () => {
    const res = await PATCH(request({ waha_session_name: 'x' }), params);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps an RPC permission error to 403', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'This action requires the admin role or higher' },
    });
    const res = await PATCH(request({ phone: '+1999' }), params);
    expect(res.status).toBe(403);
  });
});
