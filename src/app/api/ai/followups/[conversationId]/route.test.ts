import { beforeEach, describe, it, expect, vi } from 'vitest';
import { GET, POST, PATCH } from './route';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  ensure: vi.fn(),
  row: null as unknown,
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.auth,
  toErrorResponse: () => Response.json({ error: 'denied' }, { status: 403 }),
}));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/ai/followups', async (original) => ({
  ...(await original<typeof import('@/lib/ai/followups')>()),
  ensureFollowup: h.ensure,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { send: {} },
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
const params = { params: Promise.resolve({ conversationId: 'thread' }) };
beforeEach(() => {
  vi.clearAllMocks();
  h.row = null;
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: h.row, error: null }),
  };
  h.auth.mockResolvedValue({
    supabase: { from: () => chain },
    accountId: 'account',
    userId: 'agent',
  });
});
describe('follow-up conversation access', () => {
  it('does not expose another agent or tenant conversation or mutate it using service credentials', async () => {
    expect((await GET(new Request('https://crm/api'), params)).status).toBe(
      404
    );
    expect(
      (
        await PATCH(
          new Request('https://crm/api', {
            method: 'PATCH',
            body: JSON.stringify({
              id: 'foreign-task',
              status: 'acknowledged',
            }),
          }),
          params
        )
      ).status
    ).toBe(404);
    expect(h.admin).not.toHaveBeenCalled();
    expect(h.ensure).not.toHaveBeenCalled();
  });
  it('rejects missing authentication before looking up tasks', async () => {
    h.auth.mockRejectedValue(Error('unauthorized'));
    expect((await GET(new Request('https://crm/api'), params)).status).toBe(
      403
    );
    expect(h.admin).not.toHaveBeenCalled();
  });
  it('rejects arbitrary action types and completion without evidence', async () => {
    h.row = { id: 'thread' };
    expect(
      (
        await POST(
          new Request('https://crm/api', {
            method: 'POST',
            body: JSON.stringify({ kind: 'send_money' }),
          }),
          params
        )
      ).status
    ).toBe(400);
    expect(
      (
        await PATCH(
          new Request('https://crm/api', {
            method: 'PATCH',
            body: JSON.stringify({ id: 'task', status: 'completed' }),
          }),
          params
        )
      ).status
    ).toBe(400);
    expect(h.admin).not.toHaveBeenCalled();
  });
  it('scopes every service update to both the authorized conversation and account and uses the authenticated actor', async () => {
    h.row = { id: 'thread' };
    const eq = vi.fn();
    const update = vi.fn();
    const chain = {
      update: (value: unknown) => {
        update(value);
        return chain;
      },
      eq: (...args: unknown[]) => {
        eq(...args);
        return chain;
      },
      in: () => chain,
      select: () => chain,
      maybeSingle: () => Promise.resolve({ data: { id: 'task' }, error: null }),
    };
    h.admin.mockReturnValue({ from: () => chain });
    const res = await PATCH(
      new Request('https://crm/api', {
        method: 'PATCH',
        body: JSON.stringify({
          id: 'task',
          status: 'acknowledged',
          account_id: 'spoof',
          owner_id: 'spoof',
        }),
      }),
      params
    );
    expect(res.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('account_id', 'account');
    expect(eq).toHaveBeenCalledWith('conversation_id', 'thread');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: 'agent' })
    );
  });
});
