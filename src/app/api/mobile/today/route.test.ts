import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  account: vi.fn(),
  conversation: vi.fn(),
  admin: vi.fn(),
  queries: [] as unknown[],
  change: true,
  owner: null as string | null,
  role: 'agent',
  version: '2026-11-17T00:00:00+00:00',
  patch: null as unknown,
  listError: false,
}));
vi.mock('@/lib/mobile/conversation', async (original) => {
  const mod = await original<typeof import('@/lib/mobile/conversation')>();
  return {
    ...mod,
    mobileAccount: h.account,
    mobileConversation: h.conversation,
  };
});
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: h.admin }));
import { GET, POST } from './route';
const id = '12345678-1234-4234-8234-123456789abc',
  conv = '22345678-1234-4234-8234-123456789abc';
const req = (body?: unknown, offset = '0') =>
  new Request('https://crm.test/api/mobile/today?offset=' + offset, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'https://localhost',
      Authorization: 'Bearer fixture-token',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(h, {
    queries: [],
    change: true,
    owner: null,
    role: 'agent',
    patch: null,
    listError: false,
  });
  const query = (table: string, admin = false) => {
    const terminal = async () => ({
      data: admin
        ? h.change
          ? { id }
          : null
        : table === 'ai_followups'
          ? { id, owner_id: h.owner, updated_at: h.version, status: 'open' }
          : null,
      error: null,
    });
    const q = {
      select: (...v: unknown[]) => {
        h.queries.push([table, 'select', ...v]);
        return q;
      },
      eq: (...v: unknown[]) => {
        h.queries.push([table, 'eq', ...v]);
        return q;
      },
      is: (...v: unknown[]) => {
        h.queries.push([table, 'is', ...v]);
        return q;
      },
      in: (...v: unknown[]) => {
        h.queries.push([table, 'in', ...v]);
        return q;
      },
      or: (...v: unknown[]) => {
        h.queries.push([table, 'or', ...v]);
        return q;
      },
      lt: (...v: unknown[]) => {
        h.queries.push([table, 'lt', ...v]);
        return q;
      },
      order: () => q,
      range: (...v: unknown[]) => {
        h.queries.push([table, 'range', ...v]);
        return Promise.resolve({
          data: [{ id }],
          count: 51,
          error: h.listError ? {} : null,
        });
      },
      update: (p: unknown) => {
        h.patch = p;
        return q;
      },
      maybeSingle: terminal,
    };
    return q;
  };
  h.account.mockImplementation(async () => ({
    db: { from: (t: string) => query(t) },
    profile: { account_id: 'account-a', account_role: h.role },
    user: { id: 'user-a' },
  }));
  h.conversation.mockResolvedValue({
    profile: { account_id: 'account-a', account_role: 'agent' },
  });
  h.admin.mockReturnValue({ from: (t: string) => query(t, true) });
});
const update = () => ({
  id,
  conversation_id: conv,
  expected_updated_at: h.version,
  status: 'completed',
  completion_evidence: 'Synthetic completed measurement details.',
});
it('returns bounded due work with current user/account filters and pagination', async () => {
  const r = await GET(req(undefined, '25'));
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    total: 51,
    nextOffset: 50,
    timeZone: 'Asia/Qatar',
    canEdit: true,
  });
  expect(h.queries).toContainEqual([
    'ai_followups',
    'eq',
    'account_id',
    'account-a',
  ]);
  expect(h.queries).toContainEqual([
    'ai_followups',
    'or',
    'owner_id.eq.user-a,owner_id.is.null',
  ]);
  expect(h.queries).toContainEqual(['ai_followups', 'range', 25, 49]);
});
it('denies auth failures, invalid paging and partial query errors', async () => {
  h.account.mockResolvedValueOnce({
    response: new Response(null, { status: 401 }),
  });
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req(undefined, '-1'))).status).toBe(400);
  h.listError = true;
  expect((await GET(req())).status).toBe(503);
});
it('keeps viewers read-only', async () => {
  h.role = 'viewer';
  expect(await (await GET(req())).json()).toMatchObject({ canEdit: false });
  expect((await POST(req(update()))).status).toBe(403);
  expect(h.admin).not.toHaveBeenCalled();
});
it('requires a visible conversation before any service write', async () => {
  h.conversation.mockResolvedValue({
    response: new Response(null, { status: 404 }),
  });
  expect((await POST(req(update()))).status).toBe(404);
  expect(h.admin).not.toHaveBeenCalled();
});
it('guards role/account changes during authorization', async () => {
  h.conversation.mockResolvedValue({
    profile: { account_id: 'other-account', account_role: 'owner' },
  });
  expect((await POST(req(update()))).status).toBe(403);
  expect(h.admin).not.toHaveBeenCalled();
});
it('does not replace a teammate owner or stale task revision', async () => {
  h.owner = 'other-user';
  expect((await POST(req(update()))).status).toBe(409);
  h.owner = null;
  expect(
    (
      await POST(
        req({ ...update(), expected_updated_at: '2026-11-16T00:00:00Z' })
      )
    ).status
  ).toBe(409);
  expect(h.admin).not.toHaveBeenCalled();
});
it('reuses completion rules and conditionally saves an authorized task', async () => {
  expect((await POST(req(update()))).status).toBe(200);
  expect(h.patch).toMatchObject({
    status: 'completed',
    completed_by: 'user-a',
    completion_evidence: 'Synthetic completed measurement details.',
  });
  expect(h.queries).toContainEqual([
    'ai_followups',
    'eq',
    'updated_at',
    h.version,
  ]);
  expect(h.queries).toContainEqual(['ai_followups', 'is', 'owner_id', null]);
  expect(h.queries).toContainEqual([
    'ai_followups',
    'eq',
    'account_id',
    'account-a',
  ]);
  expect(h.queries).toContainEqual([
    'ai_followups',
    'eq',
    'conversation_id',
    conv,
  ]);
});
it('rejects missing evidence, injected owner and past deferrals', async () => {
  for (const body of [
    { ...update(), completion_evidence: 'short' },
    { ...update(), owner_id: 'foreign' },
    { ...update(), status: 'deferred', due_at: '2020-01-01T00:00:00Z' },
  ])
    expect((await POST(req(body))).status).toBe(400);
  expect(h.admin).not.toHaveBeenCalled();
});
it('reports concurrent task changes and bounds chunked updates', async () => {
  h.change = false;
  expect((await POST(req(update()))).status).toBe(409);
  expect((await POST(req('x'.repeat(4097)))).status).toBe(413);
});
