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
    ).toEqual({
      protocol: 1,
      textReplies: allowed,
      mediaReplies: allowed,
      voiceReplies: allowed,
    });
  }
});

const conversation = '12345678-1234-4234-8234-123456789abc';
const operation = '22345678-1234-4234-8234-123456789abc';
const upload = '32345678-1234-4234-8234-123456789abc';
function mediaClient(role = 'agent', mime = 'application/pdf', size = 200) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: { account_id: 'account-a', account_role: role },
    }),
  };
  mocks.client.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u' } }, error: null }),
    },
    from: () => query,
    storage: {
      from: () => ({
        info: async () => ({ data: { contentType: mime, size }, error: null }),
      }),
    },
  });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
}
const mediaBody = () => ({
  message_type: 'document',
  operation_id: operation,
  conversation_id: conversation,
  content_text: '',
  filename: 'notes.pdf',
  media_url: `https://fixture.supabase.co/storage/v1/object/public/chat-media/account-account-a/mobile-${conversation}-${upload}.pdf`,
});
const sendMedia = (body = mediaBody()) =>
  POST(
    new Request('https://app.test', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  );
it('delegates validated uploaded documents and photos with tracked IDs', async () => {
  mediaClient();
  expect((await sendMedia()).status).toBe(200);
  expect(mocks.send).toHaveBeenCalledOnce();
  mediaClient('agent', 'image/jpeg', 200);
  expect(
    (
      await sendMedia({
        ...mediaBody(),
        message_type: 'image',
        filename: 'photo.jpg',
        media_url: mediaBody().media_url.replace('.pdf', '.jpg'),
      })
    ).status
  ).toBe(200);
});
it.each([
  'https://evil.test/file.pdf',
  `https://fixture.supabase.co/storage/v1/object/public/chat-media/account-foreign/mobile-${conversation}-${upload}.pdf`,
  `https://fixture.supabase.co/storage/v1/object/public/chat-media/account-account-a/mobile-${operation}-${upload}.pdf`,
])(
  'rejects untrusted or foreign attachment URLs before the send engine',
  async (media_url) => {
    mediaClient();
    expect((await sendMedia({ ...mediaBody(), media_url })).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  }
);
it('blocks viewers, oversized files, MIME mismatch and overlong captions before sending', async () => {
  mediaClient('viewer');
  expect((await sendMedia()).status).toBe(403);
  mediaClient('agent', 'application/pdf', 16777217);
  expect((await sendMedia()).status).toBe(400);
  mediaClient('agent', 'text/html');
  expect((await sendMedia()).status).toBe(400);
  mediaClient();
  expect(
    (await sendMedia({ ...mediaBody(), content_text: 'a'.repeat(1025) })).status
  ).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('accepts scoped mono voice uploads without a caption and rejects captioned audio', async () => {
  mediaClient('agent', 'audio/ogg', 300);
  const body = {
    ...mediaBody(),
    message_type: 'audio',
    filename: 'voice.ogg',
    media_url: mediaBody()
      .media_url.replace(/notes\.pdf$/, 'voice.ogg')
      .replace(/\.pdf$/, '.ogg'),
  };
  expect((await sendMedia({ ...body, content_text: 'caption' })).status).toBe(
    400
  );
  await sendMedia(body);
  expect(mocks.send).toHaveBeenCalledOnce();
});
