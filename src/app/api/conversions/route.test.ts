import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireRole: vi.fn(), rpc: vi.fn(), convert: vi.fn(), after: vi.fn(), kick: vi.fn(),
  conversation: { id: 'conv-1' } as { id: string } | null,
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => { throw new Error('No service-role conversion writes in route'); },
}));
vi.mock('@/lib/conversions/poller', () => ({ kickConversionSender: h.kick }));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: h.after }));
import { POST } from './route';
const req = (body: unknown) => new Request('http://localhost/api/conversions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); h.conversation = { id: 'conv-1' };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: h.conversation, error: null }) };
  h.requireRole.mockResolvedValue({ supabase: { from: () => query, rpc: h.convert }, userId: 'user-1', accountId: 'a', role: 'agent' });
  h.convert.mockResolvedValue({ error: null }); h.rpc.mockResolvedValue({ error: null });
});
describe('conversion authorization', () => {
  it('requires agent authority', async () => {
    h.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await POST(req({ conversation_id: 'c', stage: 'won', value: 10 }))).status).toBe(403);
    expect(h.requireRole).toHaveBeenCalledWith('agent'); expect(h.convert).not.toHaveBeenCalled();
  });
  it('denies an unreadable conversation before privileged work', async () => {
    h.conversation = null;
    expect((await POST(req({ conversation_id: 'c', stage: 'won', value: 10 }))).status).toBe(404);
    expect(h.convert).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, 0, -1, 'bad', '', Infinity])('rejects invalid won amount %p', async (value) => {
    expect((await POST(req({ conversation_id: 'c', stage: 'won', value }))).status).toBe(400);
    expect(h.convert).not.toHaveBeenCalled();
  });
  it('uses authenticated atomic deal authorization, ignoring caller account and deal selectors', async () => {
    expect((await POST(req({ conversation_id: 'conv-1', stage: 'won', value: '20', account_id: 'victim', deal_id: 'victim-deal' }))).status).toBe(200);
    expect(h.convert).toHaveBeenCalledWith('record_conversation_conversion', { p_conversation_id: 'conv-1', p_stage: 'won', p_value: 20 });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each([['42501', 403], ['P0002', 409], ['XX000', 500]])('does not enqueue after rejected deal mutation %s', async (code, status) => {
    h.convert.mockResolvedValueOnce({ data: null, error: { code } });
    expect((await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 20 }))).status).toBe(status);
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.after).not.toHaveBeenCalled();
  });
  it('does not mutate a deal for a non-purchase stage', async () => {
    expect((await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))).status).toBe(200);
    expect(h.convert).toHaveBeenCalledWith('record_conversation_conversion', { p_conversation_id: 'conv-1', p_stage: 'qualified', p_value: null });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('reports enqueue failure', async () => {
    h.convert.mockResolvedValueOnce({ error: { code: 'XX000', message: 'offline dummy failure' } });
    expect((await POST(req({ conversation_id: 'conv-1', stage: 'site_visit' }))).status).toBe(500);
  });
});
