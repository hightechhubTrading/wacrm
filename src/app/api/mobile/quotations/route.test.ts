import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  account: vi.fn(),
  admin: vi.fn(),
  download: vi.fn(),
  dispatch: vi.fn(),
  visible: true,
  docVisible: true,
  role: 'agent',
  path: '',
  version: 3,
  sendState: 'ready',
  filters: [] as unknown[],
  listError: false,
  range: [] as unknown[],
}));
vi.mock('@/lib/mobile/conversation', async (original) => ({
  ...(await original<typeof import('@/lib/mobile/conversation')>()),
  mobileAccount: h.account,
}));
vi.mock('@/lib/quotations/admin-client', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/quotations/dispatch', () => ({ dispatchQuotation: h.dispatch }));
import { GET as list, OPTIONS } from './route';
import { GET as detail } from './[id]/route';
import { GET as pdf } from './[id]/pdf/route';
import { POST as send } from './[id]/send/route';
const id = '12345678-1234-4234-8234-123456789abc',
  doc = '22345678-1234-4234-8234-123456789abc',
  conv = '32345678-1234-4234-8234-123456789abc';
const ctx = { params: Promise.resolve({ id }) };
function req(tail = '', body?: unknown) {
  return new Request('https://crm.test/api/mobile/quotations/' + id + tail, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'https://localhost',
      Authorization: 'Bearer fixture-token',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const confirmation = () => ({
  confirmed: true,
  documentId: doc,
  conversationId: conv,
  workspaceVersion: 3,
  caption: 'Synthetic quote',
});
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(h, {
    visible: true,
    docVisible: true,
    role: 'agent',
    path: `${id}/rev-2-${doc}.pdf`,
    version: 3,
    sendState: 'ready',
    filters: [],
    listError: false,
    range: [],
  });
  h.download.mockResolvedValue({
    data: new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }),
    error: null,
  });
  h.admin.mockReturnValue({
    storage: { from: () => ({ download: h.download }) },
  });
  h.dispatch.mockResolvedValue(
    Response.json({ success: true, message_id: 'message-a' })
  );
  h.account.mockImplementation(async () => ({
    profile: { account_id: 'account-a', account_role: h.role },
    user: { id: 'user-a' },
    db: {
      from: (table: string) => {
        const quote = {
          id,
          account_id: 'account-a',
          reference: 'HT-TEST',
          revision: 2,
          workspace_version: h.version,
          status: 'draft',
          pdf_storage_path: h.path,
          client_name: 'Synthetic Client',
          client_phone: '+0000000',
          currency: 'QAR',
          subtotal: 123.45,
          discount_amount: 1,
          total: 122.45,
        };
        const one = async () => ({
          error: null,
          data:
            table === 'quotations'
              ? h.visible
                ? quote
                : null
              : table === 'quotation_documents'
                ? h.docVisible
                  ? {
                      id: doc,
                      revision: 2,
                      workspace_version: h.version,
                      storage_path: h.path,
                      send_state: h.sendState,
                      sent_at: null,
                      message_id: null,
                    }
                  : null
                : table === 'contacts'
                  ? { id: 'contact-a' }
                  : table === 'conversations'
                    ? { id: conv }
                    : null,
        });
        const many = async () => ({
          data:
            table === 'quotation_items'
              ? [
                  {
                    id: 'item-a',
                    item_type: 'line',
                    description: 'Synthetic line',
                    qty: 2,
                    unit_price: 61.225,
                    line_total: 122.45,
                  },
                ]
              : [quote],
          count: 26,
          error: h.listError ? {} : null,
        });
        const q = {
          select: () => q,
          eq: (...v: unknown[]) => {
            h.filters.push([table, ...v]);
            return q;
          },
          order: () => q,
          limit: (n: number) => {
            h.filters.push([table, 'limit', n]);
            return q;
          },
          range: (...v: unknown[]) => {
            h.range.push(v);
            return q;
          },
          ilike: (...v: unknown[]) => {
            h.filters.push([table, 'ilike', ...v]);
            return q;
          },
          maybeSingle: one,
          then: (resolve: (value: unknown) => unknown) => many().then(resolve),
        };
        return q;
      },
    },
  }));
});
it('maps stored money and client fields, limits paging and scopes searches to allowed columns', async () => {
  const r = await list(req('?offset=25&field=reference&search=HT_TEST'));
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.quotations[0]).toMatchObject({
    reference: 'HT-TEST',
    clientName: 'Synthetic Client',
    total: 122.45,
    currency: 'QAR',
  });
  expect(data.nextOffset).toBeNull();
  expect(h.filters).toContainEqual(['quotations', 'account_id', 'account-a']);
  expect(h.filters).toContainEqual([
    'quotations',
    'ilike',
    'reference',
    '%HT\\_TEST%',
  ]);
  expect(h.range).toContainEqual([25, 49]);
  expect((await list(req('?field=account_id'))).status).toBe(400);
  expect((await list(req('?offset=-1'))).status).toBe(400);
});
it('returns mapped detail, items, current document and authorized recipient candidate without a mutation', async () => {
  const r = await detail(req(), ctx);
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.quotation).toMatchObject({
    clientName: 'Synthetic Client',
    subtotal: 123.45,
    discountAmount: 1,
    total: 122.45,
  });
  expect(data.quotation.accountId).toBeUndefined();
  expect(data.quotation.pdfStoragePath).toBeUndefined();
  expect(data.items[0]).toMatchObject({
    description: 'Synthetic line',
    unitPrice: 61.225,
    lineTotal: 122.45,
  });
  expect(data.document).toMatchObject({
    id: doc,
    workspaceVersion: 3,
    sendState: 'ready',
  });
  expect(data.conversationId).toBe(conv);
  expect(h.admin).not.toHaveBeenCalled();
  expect(h.dispatch).not.toHaveBeenCalled();
});
it('denies unauthorized sessions and invisible quotations before privileged reads', async () => {
  h.account.mockResolvedValueOnce({
    response: new Response(null, { status: 401 }),
  });
  expect((await detail(req(), ctx)).status).toBe(401);
  h.visible = false;
  expect((await pdf(req('?version=3&document=' + doc), ctx)).status).toBe(404);
  expect(h.admin).not.toHaveBeenCalled();
});
it('serves only an exact current quotation-owned PDF with private no-store headers', async () => {
  const r = await pdf(req('?version=3&document=' + doc), ctx);
  expect(r.status).toBe(200);
  expect(h.download).toHaveBeenCalledWith(h.path);
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.get('Content-Type')).toBe('application/pdf');
  expect((await r.text()).startsWith('%PDF-')).toBe(true);
});
it('rejects stale document/version and foreign/traversal paths without storage access', async () => {
  for (const tail of [
    '?version=2&document=' + doc,
    '?version=3&document=wrong',
  ])
    expect((await pdf(req(tail), ctx)).status).toBe(409);
  for (const path of [
    'foreign/rev-2.pdf',
    `${id}/../foreign.pdf`,
    `${id}/rev-1-${doc}.pdf`,
  ]) {
    h.path = path;
    expect((await pdf(req('?version=3&document=' + doc), ctx)).status).toBe(
      409
    );
  }
  expect(h.admin).not.toHaveBeenCalled();
});
it('handles missing, oversized and non-PDF objects without exposing their bytes', async () => {
  h.download.mockResolvedValueOnce({ data: null, error: {} });
  expect((await pdf(req('?version=3&document=' + doc), ctx)).status).toBe(404);
  h.download.mockResolvedValueOnce({
    data: new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]),
    error: null,
  });
  expect((await pdf(req('?version=3&document=' + doc), ctx)).status).toBe(413);
  h.download.mockResolvedValueOnce({
    data: new Blob(['<html>not a PDF</html>']),
    error: null,
  });
  expect((await pdf(req('?version=3&document=' + doc), ctx)).status).toBe(422);
});
it('permits view-only legacy PDFs but never dispatches them as a current document', async () => {
  h.version = 0;
  h.docVisible = false;
  h.path = `${id}/rev-2.pdf`;
  expect((await pdf(req('?version=0&document=legacy'), ctx)).status).toBe(200);
  expect(
    (await send(req('', { ...confirmation(), workspaceVersion: 0 }), ctx))
      .status
  ).toBe(409);
  expect(h.dispatch).not.toHaveBeenCalled();
});
it('requires explicit confirmation and current document/version before reusing shared dispatch', async () => {
  for (const body of [
    { ...confirmation(), confirmed: false },
    { ...confirmation(), workspaceVersion: 2 },
    { ...confirmation(), documentId: 'invalid' },
    { ...confirmation(), account_id: 'foreign' },
  ])
    expect([400, 409]).toContain((await send(req('', body), ctx)).status);
  expect(h.dispatch).not.toHaveBeenCalled();
  expect((await send(req('', confirmation()), ctx)).status).toBe(200);
  expect(h.dispatch).toHaveBeenCalledOnce();
  expect(h.dispatch.mock.calls[0][0]).toMatchObject({
    accountId: 'account-a',
    userId: 'user-a',
  });
});
it('keeps viewer sends and bounded request failures away from transport', async () => {
  h.role = 'viewer';
  expect((await send(req('', confirmation()), ctx)).status).toBe(403);
  h.role = 'agent';
  expect((await send(req('', 'x'.repeat(8193)), ctx)).status).toBe(413);
  expect(h.dispatch).not.toHaveBeenCalled();
});
it('reports list failures and restricted preflight', async () => {
  h.listError = true;
  expect((await list(req())).status).toBe(503);
  expect((await OPTIONS(req())).status).toBe(204);
  expect(
    (
      await OPTIONS(
        new Request('https://crm.test', {
          headers: { Origin: 'https://evil.test' },
        })
      )
    ).status
  ).toBe(403);
});
