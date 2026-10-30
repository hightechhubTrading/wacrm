import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  authorize: vi.fn(),
  rate: vi.fn(),
}));
vi.mock('@/lib/auth/account', async (original) => ({
  ...(await original<typeof import('@/lib/auth/account')>()),
  requireRole: fixture.authorize,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: fixture.rate,
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { POST } from './route';
import { ForbiddenError } from '@/lib/auth/account';
const conversation = '10000000-0000-4000-8000-000000000001',
  message = '10000000-0000-4000-8000-000000000002';
const post = (body: unknown) =>
  POST(
    new Request('https://app.test/api/inbox/message-search', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
beforeEach(() => {
  fixture.rpc
    .mockReset()
    .mockResolvedValue({
      data: { items: [], total: 0, nextCursor: null },
      error: null,
    });
  fixture.authorize
    .mockReset()
    .mockResolvedValue({
      accountId: 'caller-account',
      userId: 'caller',
      supabase: { rpc: fixture.rpc },
    });
  fixture.rate.mockReset().mockReturnValue({ success: true });
});
it('derives account scope from the session and forwards bounded validated filters', async () => {
  const result = await post({
    query: ' نافذة ',
    accountId: 'forged',
    conversationId: conversation,
    sender: 'customer',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-31T00:00:00Z',
    limit: 100000,
  });
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(fixture.rpc).toHaveBeenCalledWith('search_inbox_messages', {
    p_account: 'caller-account',
    p_query: 'نافذة',
    p_conversation: conversation,
    p_sender: 'customer',
    p_from: '2026-10-01T00:00:00Z',
    p_to: '2026-10-31T00:00:00Z',
    p_cursor: null,
    p_limit: 25,
  });
});
it('rejects invalid queries, IDs, date bounds and cursors before database reads', async () => {
  for (const body of [
    { query: 'a' },
    { query: 'x'.repeat(201) },
    { query: 'hello', conversationId: 'bad' },
    { query: 'hello', sender: 'internal' },
    { query: 'hello', from: 'bad' },
    { query: 'hello', from: '2026-02-30T00:00:00Z' },
    { query: 'hello', from: '2026-10-01T00:00:00' },
    {
      query: 'hello',
      from: '2026-10-31T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    },
    { query: 'hello', cursor: { id: message, created_at: 'bad' } },
    { action: 'context', conversationId: conversation, messageId: 'bad' },
  ])
    expect((await post(body)).status).toBe(400);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it('loads bounded context only through the authorized RPC', async () => {
  fixture.rpc.mockResolvedValue({
    data: { found: true, messages: [{ id: message }] },
    error: null,
  });
  expect(
    (
      await post({
        action: 'context',
        conversationId: conversation,
        messageId: message,
      })
    ).status
  ).toBe(200);
  expect(fixture.rpc).toHaveBeenCalledWith('inbox_message_context', {
    p_account: 'caller-account',
    p_conversation: conversation,
    p_message: message,
  });
  fixture.rpc.mockResolvedValue({
    data: { found: false, messages: [] },
    error: null,
  });
  expect(
    (
      await post({
        action: 'context',
        conversationId: conversation,
        messageId: message,
      })
    ).status
  ).toBe(404);
});
it('distinguishes search failure from a successful empty result and enforces authorization/rate limits', async () => {
  fixture.rpc.mockResolvedValue({
    data: null,
    error: { message: 'database unavailable' },
  });
  expect((await post({ query: 'hello' })).status).toBe(503);
  fixture.authorize.mockRejectedValue(new ForbiddenError());
  expect((await post({ query: 'hello' })).status).toBe(403);
  fixture.authorize.mockResolvedValue({ userId: 'caller' });
  fixture.rate.mockReturnValue({ success: false });
  expect((await post({ query: 'hello' })).status).toBe(429);
});
