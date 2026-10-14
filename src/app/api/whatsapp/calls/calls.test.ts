import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  requireRole: vi.fn(),
  admin: vi.fn(),
  config: vi.fn(),
  visible: vi.fn(),
  permissions: vi.fn(),
  action: vi.fn(),
  scoped: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mock.requireRole,
  toErrorResponse: (error: Error & { status?: number }) =>
    Response.json({ error: error.message }, { status: error.status || 500 }),
}));
vi.mock('@/lib/whatsapp/calling/server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/calling/server')>();
  return {
    ...actual,
    callingAdmin: mock.admin,
    callingConfig: mock.config,
    visibleConversation: mock.visible,
  };
});
vi.mock('@/lib/whatsapp/calling/meta', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/calling/meta')>();
  return {
    ...actual,
    getCallPermissions: mock.permissions,
    callAction: mock.action,
  };
});
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
}));
import { POST as start } from './route';
import { POST as control } from './[id]/route';

function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const key of [
    'select',
    'eq',
    'is',
    'in',
    'update',
    'insert',
    'order',
    'limit',
  ])
    b[key] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => result);
  b.single = vi.fn(async () => result);
  b.then = (resolve: (r: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return b;
}
const call = {
  id: 'call-1',
  account_id: 'account-a',
  phone_number_id: '123',
  meta_call_id: 'wacid.1',
  direction: 'inbound',
  state: 'connecting',
  agent_user_id: 'user-a',
  owner_client_id: 'tab-a',
  answered_at: null,
  created_at: new Date().toISOString(),
};
const req = (body: unknown) =>
  new Request('http://localhost/api/whatsapp/calls', {
    method: 'POST',
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ id: call.id }) };
beforeEach(() => {
  vi.clearAllMocks();
  mock.scoped.mockReturnValue(builder({ data: call, error: null }));
  mock.requireRole.mockResolvedValue({
    userId: 'user-a',
    accountId: 'account-a',
    supabase: { from: mock.scoped },
  });
  mock.config.mockResolvedValue({
    phone_number_id: '123',
    access_token: 'secret',
  });
  mock.visible.mockResolvedValue({
    contact: { phone: '+97455555555', name: 'Customer', opted_out: false },
  });
  mock.permissions.mockResolvedValue({
    actions: [{ action_name: 'start_call', can_perform_action: false }],
  });
  mock.action.mockResolvedValue({ success: true });
  mock.admin.mockReturnValue({
    from: () => builder({ data: call, error: null }),
  });
});
describe('calling route authorization', () => {
  it('denies viewers before any configuration, database or Meta mutation', async () => {
    mock.requireRole.mockRejectedValue(
      Object.assign(new Error('Insufficient role'), { status: 403 })
    );
    const response = await control(
      req({ action: 'accept', client_id: 'tab-a' }),
      context
    );
    expect(response.status).toBe(403);
    expect(mock.admin).not.toHaveBeenCalled();
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('denies an invisible call before loading credentials', async () => {
    mock.scoped.mockReturnValue(builder({ data: null }));
    expect(
      (await control(req({ action: 'terminate', client_id: 'tab-a' }), context))
        .status
    ).toBe(404);
    expect(mock.config).not.toHaveBeenCalled();
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('prevents another browser from accepting the claimed call', async () => {
    expect(
      (
        await control(
          req({ action: 'accept', client_id: 'tab-b', sdp: 'v=0\r\nm=audio' }),
          context
        )
      ).status
    ).toBe(409);
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('prevents one user from terminating another agent call', async () => {
    mock.scoped.mockReturnValue(
      builder({ data: { ...call, agent_user_id: 'user-b' } })
    );
    expect(
      (await control(req({ action: 'terminate', client_id: 'tab-a' }), context))
        .status
    ).toBe(409);
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('allows the same agent to recover and end a call from a crashed tab', async () => {
    expect(
      (
        await control(
          req({ action: 'terminate', client_id: 'new-tab' }),
          context
        )
      ).status
    ).toBe(200);
    expect(mock.action).toHaveBeenCalledWith(expect.anything(), {
      call_id: 'wacid.1',
      action: 'terminate',
    });
  });
  it('does not send accept when SDP is missing or includes video', async () => {
    expect(
      (await control(req({ action: 'accept', client_id: 'tab-a' }), context))
        .status
    ).toBe(400);
    expect(
      (
        await control(
          req({
            action: 'accept',
            client_id: 'tab-a',
            sdp: 'v=0\r\nm=audio\r\nm=video',
          }),
          context
        )
      ).status
    ).toBe(400);
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('reports a lost claim without calling Meta', async () => {
    mock.scoped.mockReturnValue(
      builder({ data: { ...call, state: 'ringing', agent_user_id: null } })
    );
    mock.admin.mockReturnValue({
      from: () => builder({ data: null, error: null }),
    });
    expect(
      (await control(req({ action: 'claim', client_id: 'tab-a' }), context))
        .status
    ).toBe(409);
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON', async () => {
    const request = new Request('http://localhost/api/whatsapp/calls', {
      method: 'POST',
      body: '{',
    });
    expect((await start(request)).status).toBe(400);
    expect(mock.config).not.toHaveBeenCalled();
  });
  it('rechecks Meta permission before creating any outgoing call', async () => {
    expect(
      (
        await start(
          req({
            conversation_id: 'conv-a',
            client_id: 'tab-a',
            sdp: 'v=0\r\nm=audio',
          })
        )
      ).status
    ).toBe(409);
    expect(mock.visible).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-a' }),
      'conv-a'
    );
    expect(mock.permissions).toHaveBeenCalledWith(
      expect.anything(),
      '97455555555'
    );
    expect(mock.admin).not.toHaveBeenCalled();
    expect(mock.action).not.toHaveBeenCalled();
  });
  it('blocks calls to opted-out customers', async () => {
    mock.visible.mockResolvedValue({ contact: { opted_out: true } });
    expect(
      (
        await start(
          req({
            conversation_id: 'conv-a',
            client_id: 'tab-a',
            sdp: 'v=0\r\nm=audio',
          })
        )
      ).status
    ).toBe(409);
    expect(mock.permissions).not.toHaveBeenCalled();
    expect(mock.action).not.toHaveBeenCalled();
  });
});
