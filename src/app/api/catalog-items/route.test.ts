import { describe, expect, it, vi, beforeEach } from 'vitest';

function chain(finalResult: unknown) {
  const builder: Record<string, unknown> = {};
  ['select', 'ilike', 'insert', 'eq', 'limit'].forEach((m) => {
    builder[m] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(finalResult);
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

const h = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 401 }),
}));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/catalog-items', () => {
  it('searches by name using ILIKE, scoped to the caller\'s own account', async () => {
    const searchChain = chain({ data: [{ id: 'c-1', name: 'Electronic Lock' }], error: null });
    const supabase = { from: vi.fn().mockReturnValue(searchChain) };
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test/api/catalog-items?q=lock');
    const res = await GET(req);
    expect(searchChain.eq).toHaveBeenCalledWith('account_id', 'acc-1');
    expect(searchChain.ilike).toHaveBeenCalledWith('name', '%lock%');
    expect((await res.json())[0].name).toBe('Electronic Lock');
  });
});

describe('POST /api/catalog-items', () => {
  it('creates a new catalog entry under the caller\'s own account', async () => {
    const insertChain = chain({ data: { id: 'c-2', name: 'Custom Handle' }, error: null });
    const supabase = { from: vi.fn().mockReturnValue(insertChain) };
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', userId: 'u-1', supabase });

    const req = new Request('http://test/api/catalog-items', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'someone-elses-account', name: 'Custom Handle', category: 'accessory' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Custom Handle');
  });

  it('rejects an unauthenticated request', async () => {
    h.requireRole.mockRejectedValueOnce(new Error('unauthorized'));
    const req = new Request('http://test/api/catalog-items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Custom Handle' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
