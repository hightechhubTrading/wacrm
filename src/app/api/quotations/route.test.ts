import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 401 }),
}));

vi.mock('@/lib/quotations/crud', () => ({
  createQuotation: vi.fn().mockResolvedValue({ id: 'q-1', reference: 'HT-26-PIV-001', status: 'draft' }),
}));

import { GET, POST } from './route';

// Raw (snake_case) row shape, as it'd come back from Supabase.
const rawQuotationRow = {
  id: 'q-1',
  account_id: 'acc-1',
  reference: 'HT-26-PIV-001',
  revision: 1,
  status: 'draft',
  client_name: 'Acme',
  client_phone: '+974 5555 1234',
  client_company: 'Acme Co',
  location: null,
  project_name: null,
  subject: null,
  currency: 'QAR',
  contact_id: null,
  deal_id: null,
  assigned_to: null,
  discount_type: null,
  discount_value: null,
  subtotal: 100,
  discount_amount: 0,
  total: 100,
  valid_until: null,
  pdf_storage_path: null,
};

// A chainable + awaitable query-builder double matching Supabase's
// PostgrestFilterBuilder shape: `.eq()`/`.order()` return the same
// builder for further chaining, and the builder itself is a thenable
// so `await query` resolves the eventual `{ data, error }` result --
// mirroring the route's `let query = ...; if (status) query = query.eq(...)`
// pattern where the query is reassigned before being awaited.
function makeListSupabase(result: { data: unknown; error: unknown }) {
  const builder: {
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => unknown;
  } = {
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ select }));
  return { from, select, builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ accountId: 'acc-1', userId: 'u-1', role: 'agent' });
});

describe('POST /api/quotations', () => {
  it('creates a quotation using the caller\'s own account, ignoring any accountId in the body', async () => {
    const { createQuotation } = await import('@/lib/quotations/crud');
    const req = new Request('http://test/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'someone-elses-account', productCode: 'PIV', currency: 'QAR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(createQuotation).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', productCode: 'PIV' }),
    );
    const body = await res.json();
    expect(body.reference).toBe('HT-26-PIV-001');
  });

  it('rejects a request with no productCode', async () => {
    const req = new Request('http://test/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ currency: 'QAR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    h.requireRole.mockRejectedValueOnce(new Error('unauthorized'));
    const req = new Request('http://test/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ productCode: 'PIV', currency: 'QAR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/quotations', () => {
  it("scopes the query to the caller's own account via ctx.supabase, ignoring any accountId in the query string", async () => {
    const { from, select, builder } = makeListSupabase({
      data: [rawQuotationRow],
      error: null,
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase: { from } });

    const req = new Request(
      'http://test/api/quotations?accountId=someone-elses-account',
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('quotations');
    expect(select).toHaveBeenCalledWith('*');
    expect(builder.eq).toHaveBeenCalledWith('account_id', 'acc-1');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 'q-1',
      accountId: 'acc-1',
      reference: 'HT-26-PIV-001',
      clientCompany: 'Acme Co',
    });
  });

  it('applies a status filter when provided', async () => {
    const { from, builder } = makeListSupabase({ data: [], error: null });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase: { from } });

    const req = new Request('http://test/api/quotations?status=sent');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(builder.eq).toHaveBeenCalledWith('status', 'sent');
  });

  it('omits the status filter when none is given', async () => {
    const { from, builder } = makeListSupabase({ data: [], error: null });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase: { from } });

    const req = new Request('http://test/api/quotations');
    await GET(req);

    // Only the account_id filter should have been applied on this
    // builder -- 'status' never appears among the .eq() calls.
    expect(
      builder.eq.mock.calls.some(([field]) => field === 'status'),
    ).toBe(false);
  });

  it('returns 400 with the Supabase error message on query failure', async () => {
    const { from } = makeListSupabase({
      data: null,
      error: { message: 'boom' },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase: { from } });

    const req = new Request('http://test/api/quotations');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'boom' });
  });

  it('rejects an unauthenticated request', async () => {
    h.requireRole.mockRejectedValueOnce(new Error('unauthorized'));
    const req = new Request('http://test/api/quotations');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
