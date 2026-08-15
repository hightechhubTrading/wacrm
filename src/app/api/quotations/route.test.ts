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

import { POST } from './route';

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
