import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  from: vi.fn(),
  mode: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.role,
  toErrorResponse: () => Response.json({ error: 'Denied' }, { status: 403 }),
}));
vi.mock('@/lib/ai/typesafe/client', () => ({ salesAssistanceMode: h.mode }));
import { GET, PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const req = (body: object) =>
  new Request('http://localhost/api/ai/assistance', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv('TYPESAFE_API_KEY', 'synthetic-verifier-key');
  h.role.mockReset();
  h.query.mockReset();
  h.from.mockReset();
  h.mode.mockReturnValue('enforce');
  h.role.mockResolvedValue({
    supabase: { from: h.from },
    accountId: 'account',
  });
  h.from.mockImplementation(() => {
    const q = {
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: () => h.query(),
      maybeSingle: () => h.query(),
    };
    return q;
  });
  h.query.mockResolvedValue({
    data: { account_id: 'account', is_active: true },
    error: null,
  });
});
it('restricts configuration edits to admin roles', async () => {
  h.role.mockRejectedValue(Error());
  expect((await PATCH(req({ enabled: true }))).status).toBe(403);
  expect(h.role).toHaveBeenCalledWith('admin');
});
it('rejects arbitrary settings, invalid UUIDs and oversized tag rules', async () => {
  for (const body of [
    { enabled: true, send: true },
    { tag_id: 'other', rule: 'x' },
    { tag_id: id, rule: 'x'.repeat(1001) },
  ])
    expect((await PATCH(req(body))).status).toBe(400);
  expect(h.from).not.toHaveBeenCalled();
});
it('requires active AI and semantic checks before enabling', async () => {
  h.mode.mockReturnValue('off');
  expect((await PATCH(req({ enabled: true }))).status).toBe(409);
  h.mode.mockReturnValue('enforce');
  h.query.mockResolvedValue({ data: { is_active: false }, error: null });
  expect((await PATCH(req({ enabled: true }))).status).toBe(409);
});
it('allows disabling without a key and scopes updates to the account', async () => {
  h.mode.mockReturnValue('off');
  expect((await PATCH(req({ enabled: false }))).status).toBe(200);
  const q = h.from.mock.results[0].value;
  expect(q.eq).toHaveBeenCalledWith('account_id', 'account');
  expect(q.update).toHaveBeenCalledWith({ sales_assistance_enabled: false });
});
it('updates only an existing account tag and allows clearing a rule', async () => {
  expect((await PATCH(req({ tag_id: id, rule: '  ' }))).status).toBe(200);
  const q = h.from.mock.results[0].value;
  expect(q.eq).toHaveBeenCalledWith('account_id', 'account');
  expect(q.eq).toHaveBeenCalledWith('id', id);
  expect(q.update).toHaveBeenCalledWith({ ai_rule: null });
});
it('surfaces missing migration instead of claiming assistance is enabled', async () => {
  h.query.mockResolvedValue({ error: { code: '42703' }, data: null });
  expect((await GET()).status).toBe(503);
});

afterEach(() => vi.unstubAllEnvs());
