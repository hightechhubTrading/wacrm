import { beforeEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ role: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: m.role,
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
import { POST } from './route';
const id = '11111111-1111-1111-1111-111111111111';
function request(body: unknown) {
  return new Request('http://local', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({
    accountId: 'real-account',
    supabase: { rpc: m.rpc },
  });
  m.rpc.mockResolvedValue({ data: [], error: null });
});
it('requires an agent session', async () => {
  m.role.mockRejectedValue(new Error('no'));
  expect((await POST(request({ ids: [id] }))).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('derives account scope and deduplicates ids', async () => {
  expect(
    (await POST(request({ ids: [id, id], accountId: 'other' }))).status
  ).toBe(200);
  expect(m.role).toHaveBeenCalledWith('agent');
  expect(m.rpc).toHaveBeenCalledWith('inbox_sales_context', {
    p_account: 'real-account',
    p_ids: [id],
  });
});
it('rejects oversized or malformed batches', async () => {
  expect((await POST(request({ ids: Array(501).fill(id) }))).status).toBe(400);
  expect((await POST(request({ ids: ['bad-id'] }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('reports unavailable data rather than silently treating errors as an empty inbox', async () => {
  m.rpc.mockResolvedValue({ data: null, error: {} });
  expect((await POST(request({ ids: [id] }))).status).toBe(503);
});
