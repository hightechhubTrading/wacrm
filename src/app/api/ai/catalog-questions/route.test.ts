import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  current: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.current,
  requireRole: h.role,
  toErrorResponse: (e: unknown) =>
    new Response(JSON.stringify({ error: String(e) }), { status: 403 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.limit,
  rateLimitResponse: () => new Response('{}', { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
import { GET, POST, PATCH } from './route';
const request = (body: unknown) =>
  new Request('https://local.invalid/api/ai/catalog-questions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
let writes: unknown[];
let filters: unknown[];
beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  filters = [];
  h.limit.mockReturnValue({ success: true });
  const q = {
    select: () => q,
    eq: (...v: unknown[]) => {
      filters.push(v);
      return q;
    },
    order: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: { id: 'saved' }, error: null }),
  };
  const db = {
    from: () => ({
      insert: (value: unknown) => {
        writes.push(value);
        return q;
      },
      update: (value: unknown) => {
        writes.push(value);
        return q;
      },
      select: () => q,
    }),
  };
  const ctx = { supabase: db, accountId: 'account', userId: 'user' };
  h.role.mockResolvedValue(ctx);
  h.current.mockResolvedValue(ctx);
});
it('lists only the current account questions', async () => {
  expect((await GET()).status).toBe(200);
  expect(filters).toContainEqual(['account_id', 'account']);
});
it('requires admin before reading or writing the body', async () => {
  h.role.mockRejectedValue(new Error('admin required'));
  expect((await POST(request({ question: 'Q' }))).status).toBe(403);
  expect(writes).toEqual([]);
});
it('ignores caller account and approval fields when saving answers', async () => {
  expect(
    (
      await POST(
        request({
          question: 'Q',
          answer: 'A',
          status: 'answered',
          account_id: 'foreign',
          approved: true,
        })
      )
    ).status
  ).toBe(200);
  expect(writes).toEqual([
    {
      question: 'Q',
      answer: 'A',
      status: 'answered',
      account_id: 'account',
      created_by: 'user',
    },
  ]);
  expect(h.role).toHaveBeenCalledWith('admin');
});
it('does not mark an empty answer as answered', async () => {
  expect(
    (
      await PATCH(
        request({
          id: '10000000-0000-4000-8000-000000000001',
          status: 'answered',
          answer: '',
        })
      )
    ).status
  ).toBe(400);
  expect(writes).toEqual([]);
});
it('scopes edits to the current account and selected record', async () => {
  expect(
    (
      await PATCH(
        request({ id: '10000000-0000-4000-8000-000000000001', question: 'Q' })
      )
    ).status
  ).toBe(200);
  expect(filters).toEqual([
    ['account_id', 'account'],
    ['id', '10000000-0000-4000-8000-000000000001'],
  ]);
});
