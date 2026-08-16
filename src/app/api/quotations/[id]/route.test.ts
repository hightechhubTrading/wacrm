import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  saveQuotationItems: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 401 }),
}));

vi.mock('@/lib/quotations/crud', () => ({
  saveQuotationItems: h.saveQuotationItems,
}));

import { GET, PATCH } from './route';

// Raw (snake_case) row shapes, as they'd come back from Supabase.
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
  quotation_items: [
    {
      id: 'item-1',
      quotation_id: 'q-1',
      parent_item_id: null,
      product_id: null,
      position: 0,
      item_type: 'line',
      kind: null,
      item_code: 'X1',
      description: 'A widget',
      description_ar: 'أداة',
      size_w: null,
      size_h: null,
      qty: 1,
      unit_price: 100,
      discount_type: null,
      discount_value: null,
      line_total: 100,
    },
  ],
};

// Builds a minimal ctx.supabase test double. `existingResult` backs any
// `.maybeSingle()` call (GET's lookup, and PATCH's pre-write existence
// check); `finalResult` backs any `.single()` call (PATCH's post-write
// re-fetch). `updateFn` backs `.update(...)`.
function makeSupabase(opts: {
  existingResult?: { data: unknown; error: unknown };
  finalResult?: { data: unknown; error: unknown };
  updateResult?: { error: unknown };
}) {
  const eqChain = {
    maybeSingle: () =>
      Promise.resolve(opts.existingResult ?? { data: null, error: null }),
    single: () => Promise.resolve(opts.finalResult ?? { data: null, error: null }),
  };
  const select = vi.fn(() => ({ eq: vi.fn(() => eqChain) }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve(opts.updateResult ?? { error: null })),
  }));
  const from = vi.fn(() => ({ select, update }));
  return { from, select, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    accountId: 'acc-1',
    userId: 'u-1',
    role: 'agent',
  });
});

describe('GET /api/quotations/[id]', () => {
  it('returns 404 without leaking anything when the row is invisible under RLS', async () => {
    const supabase = makeSupabase({ existingResult: { data: null, error: null } });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const res = await GET(new Request('http://test/api/quotations/q-1'), {
      params: Promise.resolve({ id: 'q-1' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Quotation not found' });
  });

  it('returns the mapped (camelCase) quotation with mapped nested items when visible', async () => {
    const supabase = makeSupabase({
      existingResult: { data: rawQuotationRow, error: null },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const res = await GET(new Request('http://test/api/quotations/q-1'), {
      params: Promise.resolve({ id: 'q-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'q-1',
      accountId: 'acc-1',
      reference: 'HT-26-PIV-001',
      clientName: 'Acme',
      clientCompany: 'Acme Co',
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'item-1',
      quotationId: 'q-1',
      itemCode: 'X1',
      descriptionAr: 'أداة',
      unitPrice: 100,
      lineTotal: 100,
    });
  });
});

describe('PATCH /api/quotations/[id]', () => {
  it('returns 404 and never reaches saveQuotationItems when the existence check finds nothing', async () => {
    const supabase = makeSupabase({ existingResult: { data: null, error: null } });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test/api/quotations/q-1', {
      method: 'PATCH',
      body: JSON.stringify({ items: [{ id: 'item-1', itemType: 'line', qty: 1, unitPrice: 10 }] }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Quotation not found' });
    expect(h.saveQuotationItems).not.toHaveBeenCalled();
  });

  it('saves items, updates fields, and returns the mapped final row when the quotation is visible', async () => {
    const supabase = makeSupabase({
      existingResult: { data: { id: 'q-1' }, error: null },
      finalResult: { data: rawQuotationRow, error: null },
      updateResult: { error: null },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });
    h.saveQuotationItems.mockResolvedValue(undefined);

    const items = [{ id: 'item-1', itemType: 'line', qty: 1, unitPrice: 100 }];
    const orderDiscount = { type: 'percent', value: 5 };
    const fields = { client_name: 'New Name' };

    const req = new Request('http://test/api/quotations/q-1', {
      method: 'PATCH',
      body: JSON.stringify({ items, orderDiscount, fields }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) });

    expect(h.saveQuotationItems).toHaveBeenCalledWith('q-1', 'acc-1', items, orderDiscount);
    expect(supabase.update).toHaveBeenCalledWith(fields);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'q-1',
      accountId: 'acc-1',
      reference: 'HT-26-PIV-001',
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 'item-1', itemCode: 'X1' });
  });

  it('accepts status as a legitimate writable field', async () => {
    const supabase = makeSupabase({
      existingResult: { data: { id: 'q-1' }, error: null },
      finalResult: { data: { ...rawQuotationRow, status: 'sent' }, error: null },
      updateResult: { error: null },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test/api/quotations/q-1', {
      method: 'PATCH',
      body: JSON.stringify({ fields: { status: 'sent' } }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) });

    expect(supabase.update).toHaveBeenCalledWith({ status: 'sent' });
    expect(res.status).toBe(200);
  });

  it('drops fields outside the allow-list (e.g. subtotal/total/discount_amount) instead of writing them', async () => {
    const supabase = makeSupabase({
      existingResult: { data: { id: 'q-1' }, error: null },
      finalResult: { data: rawQuotationRow, error: null },
      updateResult: { error: null },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test/api/quotations/q-1', {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          client_name: 'Allowed',
          subtotal: 999999,
          total: 999999,
          discount_amount: 999999,
          revision: 42,
        },
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) });

    expect(supabase.update).toHaveBeenCalledWith({ client_name: 'Allowed' });
    expect(res.status).toBe(200);
  });

  it('skips the update call entirely when fields contains only disallowed keys', async () => {
    const supabase = makeSupabase({
      existingResult: { data: { id: 'q-1' }, error: null },
      finalResult: { data: rawQuotationRow, error: null },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test/api/quotations/q-1', {
      method: 'PATCH',
      body: JSON.stringify({ fields: { total: 999999 } }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) });

    expect(supabase.update).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('returns 400 with the real error message when saveQuotationItems throws, instead of a generic 500', async () => {
    const supabase = makeSupabase({
      existingResult: { data: { id: 'q-1' }, error: null },
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });
    h.saveQuotationItems.mockRejectedValueOnce(new Error('Quotation not found'));

    const items = [{ id: 'item-1', itemType: 'line', qty: 1, unitPrice: 100 }];
    const req = new Request('http://test/api/quotations/q-1', {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Quotation not found' });
  });
});
