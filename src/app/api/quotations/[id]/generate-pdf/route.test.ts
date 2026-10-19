import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  generateQuotationPdf: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 401 }),
}));

vi.mock('@/lib/quotations/pdf', () => ({
  generateQuotationPdf: h.generateQuotationPdf,
}));

import { POST } from './route';

// Raw (snake_case) row shape, as it comes back from Supabase — same
// fixture convention as src/app/api/quotations/[id]/route.test.ts.
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
  project_name: 'Villa 12',
  subject: 'sliding doors',
  currency: 'QAR',
  delivery_terms: 'Delivery agreed',
  payment_terms: 'Payment agreed',
  contact_id: null,
  deal_id: null,
  assigned_to: null,
  discount_type: null,
  discount_value: null,
  subtotal: 100,
  discount_amount: 0,
  total: 100,
  valid_until: '2027-10-17',
  created_at: '2026-10-17T10:00:00Z',
  pdf_storage_path: null,
  quotation_items: [
    {
      id: '00000000-0000-4000-8000-000000000001',
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

function makeSupabase(opts: {
  selectResult?: { data: unknown; error: unknown };
  updateResult?: { error: unknown };
}) {
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: () => Promise.resolve(opts.selectResult ?? { data: null, error: null }),
    })),
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve(opts.updateResult ?? { error: null })),
  }));
  const from = vi.fn(() => ({ select, update }));
  return { from, select, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.generateQuotationPdf.mockResolvedValue({
    storagePath: 'q-1/rev-1.pdf',
    publicUrl: 'https://cdn.test/q-1/rev-1.pdf',
  });
});

describe('POST /api/quotations/[id]/generate-pdf', () => {
  it('maps the snake_case DB row to the camelCase Quotation/QuotationItem shape before rendering', async () => {
    const supabase = makeSupabase({ selectResult: { data: rawQuotationRow, error: null } });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    const body = await res.json();

    expect(h.generateQuotationPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'q-1',
        clientName: 'Acme',
        clientCompany: 'Acme Co',
        clientPhone: '+974 5555 1234',
        projectName: 'Villa 12',
        subject: 'sliding doors',
      }),
      [
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000001',
          itemType: 'line',
          itemCode: 'X1',
          unitPrice: 100,
          lineTotal: 100,
        }),
      ],
    );
    expect(res.status).toBe(200);
    expect(body.storagePath).toBe('q-1/rev-1.pdf');
    expect(body.publicUrl).toBe('https://cdn.test/q-1/rev-1.pdf');
  });

  it('bumps the revision when the quotation was already sent, and persists it', async () => {
    const sentRow = { ...rawQuotationRow, status: 'sent', revision: 1 };
    const supabase = makeSupabase({ selectResult: { data: sentRow, error: null } });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    const body = await res.json();

    expect(h.generateQuotationPdf).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2 }),
      expect.any(Array),
    );
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2 }),
    );
    expect(body.revision).toBe(2);
  });

  it('keeps the current revision for a draft quotation', async () => {
    const supabase = makeSupabase({ selectResult: { data: rawQuotationRow, error: null } });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    const body = await res.json();

    expect(body.revision).toBe(1);
  });

  it('returns 404 if the quotation is not visible to the caller', async () => {
    const supabase = makeSupabase({ selectResult: { data: null, error: null } });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    expect(res.status).toBe(404);
  });
});


it('rejects stored HTML in document details before starting the renderer', async () => {
  const supabase = makeSupabase({ selectResult: { data: { ...rawQuotationRow, document_details: { shopDrawingDays: '<iframe src="http://127.0.0.1/marker"></iframe>' } }, error: null } });
  h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });
  expect((await POST(new Request('http://test', { method: 'POST' }), { params: Promise.resolve({ id: 'q-1' }) })).status).toBe(400);
  expect(h.generateQuotationPdf).not.toHaveBeenCalled();
});
it('does not validate synthesized defaults while exporting missing saved terms', async () => {
  const supabase = makeSupabase({ selectResult: { data: { ...rawQuotationRow, valid_until: null, delivery_terms: null, payment_terms: null }, error: null } });
  h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });
  expect((await POST(new Request('http://test', { method: 'POST' }), { params: Promise.resolve({ id: 'q-1' }) })).status).toBe(400);
  expect(h.generateQuotationPdf).not.toHaveBeenCalled();
});
