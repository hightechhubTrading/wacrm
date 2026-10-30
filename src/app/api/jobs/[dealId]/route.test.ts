import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
  clientFrom: vi.fn(),
  adminFrom: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.role,
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: mocks.admin }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { send: {}, bulkMediaUpload: {} },
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
import { POST, PATCH, GET } from './route';
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'order', 'limit', 'insert'])
    q[key] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => result);
  q.single = vi.fn(async () => result);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}
const params = { params: Promise.resolve({ dealId: 'deal-1' }) };
let responses: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  responses = {
    deals: {
      data: { id: 'deal-1', title: 'Project', contact: null },
      error: null,
    },
    quotations: { data: null, error: null },
    group_handoffs: {
      data: { id: 'work-1', kind: 'measurement', status: 'waiting' },
      error: null,
    },
  };
  mocks.clientFrom.mockImplementation((table) => chain(responses[table]));
  mocks.role.mockResolvedValue({
    accountId: 'account-1',
    userId: 'user-1',
    supabase: { from: mocks.clientFrom },
  });
  mocks.admin.mockReturnValue({
    from: mocks.adminFrom,
    rpc: mocks.rpc,
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: mocks.remove,
        createSignedUrl: mocks.signed,
      }),
    },
  });
  mocks.adminFrom.mockReturnValue(
    chain({ data: { id: 'work-1' }, error: null })
  );
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: 'event-1', error: null });
});
function create(body: unknown) {
  return new Request('http://local/api/jobs/deal-1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
function update(action: string, note = '', files = false) {
  const form = new FormData();
  form.set('id', 'work-1');
  form.set('revision', '0');
  form.set('action', action);
  form.set('note', note);
  if (files)
    form.append(
      'files',
      new Blob(['photo'], { type: 'image/png' }),
      'photo.png'
    );
  return new Request('http://local/api/jobs/deal-1', {
    method: 'PATCH',
    body: form,
  });
}
describe('sales group work access and recording', () => {
  it('requires authentication', async () => {
    mocks.role.mockRejectedValue(new Error('unauthorized'));
    expect((await POST(create({}), params)).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('does not write to a deal hidden by assignment RLS', async () => {
    responses.deals = { data: null, error: null };
    expect(
      (
        await POST(
          create({
            kind: 'measurement',
            location: 'Doha',
            details: 'Two shutter openings',
          }),
          params
        )
      ).status
    ).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('derives actor and tenant from the session', async () => {
    const res = await POST(
      create({
        kind: 'measurement',
        location: 'Doha',
        details: 'Two shutter openings',
        account_id: 'foreign',
        created_by: 'attacker',
      }),
      params
    );
    expect(res.status).toBe(201);
    const builder = mocks.adminFrom.mock.results[0].value;
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        created_by: 'user-1',
        deal_id: 'deal-1',
      })
    );
  });
  it('requires an accepted quotation belonging to the visible deal', async () => {
    expect(
      (
        await POST(
          create({
            kind: 'workshop',
            location: 'Doha',
            details: 'Make five shutters',
            quotation_id: 'foreign-quote',
          }),
          params
        )
      ).status
    ).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('freezes the accepted quotation revision and ordered line items', async () => {
    responses.quotations = {
      data: {
        id: 'q1',
        reference: 'Q1',
        revision: 3,
        quotation_items: [
          {
            item_type: 'line',
            position: 0,
            description: 'Five shutters',
            description_ar: null,
            size_w: 2,
            size_h: 3,
            qty: 5,
          },
        ],
      },
      error: null,
    };
    expect(
      (
        await POST(
          create({
            kind: 'workshop',
            location: 'Doha',
            details: 'Make five shutters',
            quotation_id: 'q1',
          }),
          params
        )
      ).status
    ).toBe(201);
    expect(mocks.adminFrom.mock.results[0].value.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        quotation_snapshot: expect.objectContaining({
          revision: 3,
          items: [expect.objectContaining({ qty: 5 })],
        }),
      })
    );
  });
  it('requires evidence before accepting a measurement report', async () => {
    expect((await PATCH(update('report'), params)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('keeps attachments private and saves source actor in the atomic event', async () => {
    expect((await PATCH(update('report', '', true), params)).status).toBe(200);
    expect(mocks.upload.mock.calls[0][0]).toMatch(
      /^account-1\/deal-1\/work-1\//
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'record_group_handoff_event',
      expect.objectContaining({
        p_actor: 'user-1',
        p_account: 'account-1',
        p_status: 'report_received',
        p_attachments: [expect.objectContaining({ name: 'photo.png' })],
      })
    );
  });
  it('removes uploaded files when a stale revision is rejected', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await PATCH(update('report', '', true), params)).status).toBe(409);
    expect(mocks.remove).toHaveBeenCalled();
  });
  it('rejects state transitions before uploading', async () => {
    expect(
      (await PATCH(update('installed', 'Completed installation', true), params))
        .status
    ).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('does not sign attachments from another job', async () => {
    responses.group_handoffs = {
      data: [
        {
          id: 'work-1',
          events: [
            {
              attachments: [
                { path: 'foreign/deal/work/file', name: 'x', size: 1 },
              ],
              created_at: '2026-10-12',
            },
          ],
        },
      ],
      error: null,
    };
    responses.quotations = { data: [], error: null };
    expect((await GET(new Request('http://local'), params)).status).toBe(200);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
});

it('bounds the compact overview, preserves independent failures and never signs attachments', async () => {
  responses.group_handoffs = {
    data: [{ id: 'work-1', events: [] }],
    error: null,
  };
  responses.quotations = { data: null, error: { message: 'unavailable' } };
  const response = await GET(new Request('http://local?overview=1'), params);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({
    work: [{ id: 'work-1', events: [] }],
    quotations: [],
    workError: false,
    quotationsError: true,
  });
  expect(mocks.admin).not.toHaveBeenCalled();
  const index = mocks.clientFrom.mock.calls.findIndex(
    ([name]) => name === 'group_handoffs'
  );
  const query = mocks.clientFrom.mock.results[index].value;
  expect(query.eq).toHaveBeenCalledWith('account_id', 'account-1');
  expect(query.eq).toHaveBeenCalledWith('deal_id', 'deal-1');
  expect(query.limit).toHaveBeenCalledWith(50);
  expect(query.limit).toHaveBeenCalledWith(20, { referencedTable: 'events' });
  expect(query.select.mock.calls[0][0]).not.toContain('attachments');
});
it('does not turn failed work into an empty successful history', async () => {
  responses.group_handoffs = { data: null, error: { message: 'unavailable' } };
  responses.quotations = { data: [{ id: 'accepted' }], error: null };
  const response = await GET(new Request('http://local?overview=1'), params);
  expect(await response.json()).toEqual({
    work: [],
    quotations: [{ id: 'accepted' }],
    workError: true,
    quotationsError: false,
  });
});
