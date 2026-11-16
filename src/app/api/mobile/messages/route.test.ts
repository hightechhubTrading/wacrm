import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  get: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@/app/api/whatsapp/send/route', () => ({
  POST: mocks.send,
  GET: mocks.get,
}));
vi.mock('@/lib/supabase/request', () => ({
  createRequestClient: mocks.client,
}));
import { POST, GET, OPTIONS } from './route';
const headers = {
  authorization: 'Bearer user.jwt.signature',
  origin: 'https://localhost',
  'content-type': 'application/json',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue(Response.json({ success: true }));
  mocks.get.mockResolvedValue(Response.json({ outcome: 'unknown' }));
});
it('requires a human bearer header even when cookies exist', async () => {
  expect(
    (
      await POST(
        new Request('https://app.test/api/mobile/messages', {
          method: 'POST',
          headers: { cookie: 'session=abc' },
        })
      )
    ).status
  ).toBe(401);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('rejects foreign origins and allows only native preflight', async () => {
  expect(
    (
      await OPTIONS(
        new Request('https://app.test', {
          headers: { origin: 'https://attacker.test' },
        })
      )
    ).status
  ).toBe(403);
  const r = await OPTIONS(new Request('https://app.test', { headers }));
  expect(r.status).toBe(204);
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe(
    'https://localhost'
  );
});
it('rejects untracked sends and non-text actions', async () => {
  for (const body of [
    { message_type: 'text' },
    { message_type: 'image', operation_id: 'a', conversation_id: 'b' },
    {
      message_type: 'text',
      operation_id: 'a',
      conversation_id: 'b',
      contact_id: 'c',
    },
  ])
    expect(
      (
        await POST(
          new Request('https://app.test', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          })
        )
      ).status
    ).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('delegates tracked text sends to the existing engine', async () => {
  const r = await POST(
    new Request('https://app.test', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message_type: 'text',
        operation_id: 'a',
        conversation_id: 'b',
        content_text: 'synthetic',
      }),
    })
  );
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe(
    'https://localhost'
  );
});
it('delegates reconciliation to the existing authorized ledger lookup', async () => {
  await GET(new Request('https://app.test?operation_id=a', { headers }));
  expect(mocks.get).toHaveBeenCalledOnce();
});
it('capabilities deny invalid sessions and honor viewer roles', async () => {
  mocks.client.mockResolvedValueOnce({
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: 'invalid' },
      }),
    },
  });
  expect((await GET(new Request('https://app.test', { headers }))).status).toBe(
    401
  );
  for (const [role, allowed] of [
    ['viewer', false],
    ['agent', true],
  ]) {
    const terminal = {
      maybeSingle: async () => ({
        data: { account_id: 'a', account_role: role },
        error: null,
      }),
    };
    mocks.client.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u' } }, error: null }),
      },
      from: () => ({ select: () => ({ eq: () => terminal }) }),
    });
    expect(
      await (await GET(new Request('https://app.test', { headers }))).json()
    ).toEqual({ protocol: 1, textReplies: allowed });
  }
});
