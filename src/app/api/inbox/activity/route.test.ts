import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('@/lib/auth/account', async (original) => ({
  ...(await original<typeof import('@/lib/auth/account')>()),
  requireRole: fixture.authorize,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: fixture.limit,
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { GET, POST } from './route';
import { ForbiddenError } from '@/lib/auth/account';
const conversation = '10000000-0000-4000-8000-000000000001',
  tab = '10000000-0000-4000-8000-000000000002';
const post = (overrides = {}) =>
  POST(
    new Request('https://app.test/api/inbox/activity', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: conversation,
        tabId: tab,
        sequence: 1,
        composing: true,
        leave: false,
        ...overrides,
      }),
    })
  );
beforeEach(() => {
  fixture.authorize
    .mockReset()
    .mockResolvedValue({
      userId: 'caller',
      accountId: 'own-account',
      supabase: { rpc: fixture.rpc },
    });
  fixture.rpc
    .mockReset()
    .mockResolvedValue({
      data: { serverNow: '2026-10-30T09:00:00Z', peers: [] },
      error: null,
    });
  fixture.limit.mockReset().mockReturnValue({ success: true });
});
it('passes only validated activity facts; actor, tenant and clock stay server-derived', async () => {
  const response = await post({
    userId: 'forged',
    accountId: 'foreign',
    expiresAt: '2099-01-01',
  });
  expect(response.status).toBe(200);
  expect(fixture.authorize).toHaveBeenCalledWith('agent');
  expect(fixture.rpc).toHaveBeenCalledWith('record_conversation_activity', {
    p_conversation: conversation,
    p_tab: tab,
    p_sequence: 1,
    p_composing: true,
    p_leave: false,
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('uses a read-only snapshot for realtime invalidation rather than generating another write', async () => {
  expect(
    (
      await GET(
        new Request(
          `https://app.test/api/inbox/activity?conversationId=${conversation}&tabId=${tab}`
        )
      )
    ).status
  ).toBe(200);
  expect(fixture.rpc).toHaveBeenCalledWith('conversation_activity_snapshot', {
    p_conversation: conversation,
    p_tab: tab,
  });
});
it('rejects malformed identities, sequences and activity flags before storage', async () => {
  for (const change of [
    { conversationId: 'bad' },
    { tabId: 'bad' },
    { sequence: 0 },
    { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { composing: 'yes' },
    { leave: null },
  ])
    expect((await post(change)).status).toBe(400);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it('does not report an unavailable/forbidden snapshot as an empty team', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  expect((await post()).status).toBe(403);
  fixture.rpc.mockResolvedValue({ data: null, error: { code: 'unavailable' } });
  expect((await post()).status).toBe(503);
  fixture.authorize.mockRejectedValue(new ForbiddenError());
  expect((await post()).status).toBe(403);
  fixture.authorize.mockResolvedValue({ userId: 'caller' });
  fixture.limit.mockReturnValue({ success: false });
  expect((await post()).status).toBe(429);
});
