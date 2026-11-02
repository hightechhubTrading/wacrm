import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ role: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.role,
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
import { GET } from './route';
import { POST as review } from './review/route';
import { POST as importPack } from './import/route';
import { PUT as followup } from '../[id]/followup/route';
const request = (url: string, body: unknown) =>
  new Request('http://local' + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
let eq: ReturnType<typeof vi.fn>;
let chain: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  eq = vi.fn(() => chain);
  chain = {
    eq,
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { id: 'record', kind: 'price' }, error: null })
    ),
    range: vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 })),
  };
  h.from.mockReturnValue(chain);
  h.rpc.mockResolvedValue({ data: 'batch', error: null });
  h.role.mockResolvedValue({
    accountId: 'account',
    supabase: { from: h.from, rpc: h.rpc },
    role: 'admin',
  });
});
describe('quotation knowledge route boundaries', () => {
  it('denies unauthenticated source reads and imports before accessing data', async () => {
    h.role.mockRejectedValue(Error('Forbidden'));
    expect((await GET(new Request('http://local'))).status).toBe(403);
    expect((await importPack(request('/import', {}))).status).toBe(403);
    expect(h.from).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('uses the authenticated account and handles an empty library without importing anything', async () => {
    const response = await GET(new Request('http://local'));
    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('account_id', 'account');
    expect((await response.json()).records).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('requires an admin, confirmation notes and explicit selling-price configuration', async () => {
    const response = await review(
      request('/review', {
        id: 'record',
        version: 0,
        status: 'approved',
        notes: 'Confirmed',
        configuration: {},
      })
    );
    expect(h.role).toHaveBeenCalledWith('admin');
    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(
      (
        await review(
          request('/review', {
            id: 'record',
            version: 0,
            status: 'approved',
            notes: '',
            configuration: {},
          })
        )
      ).status
    ).toBe(400);
  });
  it('rejects foreign catalog mapping and malformed currency before writing a review', async () => {
    expect(
      (
        await review(
          request('/review', {
            id: 'record',
            version: 0,
            status: 'approved',
            notes: 'Confirmed',
            configuration: {
              pricing: { basis: 'area', rate: 390, currency: 'EUR' },
            },
          })
        )
      ).status
    ).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('passes the expected review version and reports concurrent review conflicts', async () => {
    h.rpc.mockResolvedValue({
      error: { code: '40001', message: 'Review changed' },
    });
    const response = await review(
      request('/review', {
        id: 'record',
        version: 2,
        status: 'approved',
        notes: 'Company confirmed rate',
        configuration: {
          pricing: { basis: 'area', rate: 390, currency: 'QAR' },
        },
      })
    );
    expect(response.status).toBe(409);
    expect(h.rpc).toHaveBeenCalledWith(
      'review_quotation_knowledge',
      expect.objectContaining({ p_version: 2, p_status: 'approved' })
    );
  });
  it('does not accept a caller-controlled account or reviewed status from an import pack', async () => {
    const pack = {
      format: 1,
      version: 'a'.repeat(64),
      label: 'Fixture',
      sources: [{ file: 'a.csv', sha256: 'b'.repeat(64), rows: 1 }],
      records: [
        {
          key: 'a:2',
          kind: 'price',
          source: 'a.csv',
          row: 2,
          data: { col_O: '390' },
          review_status: 'approved',
        },
      ],
      accountId: 'foreign',
    };
    expect((await importPack(request('/import', pack))).status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith(
      'import_quotation_knowledge',
      expect.objectContaining({ p_account_id: 'account' })
    );
  });
  it('rejects corrupt import structure and impossible follow-up dates', async () => {
    expect(
      (await importPack(request('/import', { format: 1, records: [{}] })))
        .status
    ).toBe(400);
    const bad = new Request('http://local/followup', {
      method: 'PUT',
      body: JSON.stringify({
        version: 0,
        reason: 'Later',
        followUpDate: '2026-02-30',
      }),
    });
    expect(
      (await followup(bad, { params: Promise.resolve({ id: 'q' }) })).status
    ).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
