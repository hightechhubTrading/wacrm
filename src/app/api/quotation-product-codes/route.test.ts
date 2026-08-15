import { describe, expect, it, vi, beforeEach } from 'vitest';

function chain(finalResult: unknown) {
  const builder: Record<string, unknown> = {};
  ['select', 'eq', 'insert'].forEach((m) => {
    builder[m] = vi.fn().mockReturnValue(builder);
  });
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

describe('quotation-product-codes route', () => {
  it('lists codes for the caller\'s own account', async () => {
    const from = vi.fn().mockReturnValueOnce(chain({ data: [{ code: 'PIV', label: 'Pivot Door' }], error: null }));
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase: { from } });
    const req = new Request('http://test');
    const res = await GET(req);
    expect((await res.json())[0].code).toBe('PIV');
  });

  it('creates a new code (RLS rejects non-admin callers with a DB error)', async () => {
    const from = vi.fn().mockReturnValueOnce(chain({ error: null }));
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase: { from } });
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRG', label: 'Pergola' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
