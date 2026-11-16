import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  client: vi.fn(),
  upload: vi.fn(),
  rate: vi.fn(),
  role: 'agent',
  user: true,
  account: true,
  visible: true,
}));
vi.mock('@/lib/supabase/request', () => ({ createRequestClient: h.client }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.rate,
  RATE_LIMITS: { send: { limit: 60, windowMs: 60000 } },
}));
import { POST, OPTIONS } from './route';
const conversationId = '12345678-1234-4234-8234-123456789abc';
const headers = {
  authorization: 'Bearer fixture-token',
  origin: 'https://localhost',
};
function req(
  file = new File(['%PDF-1.4 fixture'], 'notes.pdf', {
    type: 'application/pdf',
  }),
  conversation = conversationId
) {
  const data = new FormData();
  data.set('file', file);
  data.set('conversation_id', conversation);
  return new Request('https://crm.test/api/mobile/uploads', {
    method: 'POST',
    headers,
    body: data,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.role = 'agent';
  h.user = true;
  h.account = true;
  h.visible = true;
  h.rate.mockReturnValue({ success: true });
  h.upload.mockResolvedValue({ error: null });
  h.client.mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: { user: h.user ? { id: 'user-a' } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data:
            table === 'profiles'
              ? h.account
                ? { account_id: 'account-a', account_role: h.role }
                : null
              : h.visible
                ? { id: conversationId }
                : null,
          error: null,
        }),
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: h.upload,
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl:
              'https://fixture.supabase.co/storage/v1/object/public/chat-media/' +
              path,
          },
        }),
      }),
    },
  });
});
it('requires bearer auth and exact native origin before accepting uploads', async () => {
  expect(
    (await POST(new Request('https://crm.test', { method: 'POST' }))).status
  ).toBe(401);
  expect(
    (
      await POST(
        new Request('https://crm.test', {
          method: 'POST',
          headers: { ...headers, origin: 'https://evil.test' },
        })
      )
    ).status
  ).toBe(403);
  expect(h.client).not.toHaveBeenCalled();
  expect(
    (await OPTIONS(new Request('https://crm.test', { headers }))).status
  ).toBe(204);
});
it.each(['no-user', 'no-account', 'viewer', 'hidden', 'rate-limit'])(
  'denies %s without storage writes',
  async (reason) => {
    if (reason === 'no-user') h.user = false;
    if (reason === 'no-account') h.account = false;
    if (reason === 'viewer') h.role = 'viewer';
    if (reason === 'hidden') h.visible = false;
    if (reason === 'rate-limit') h.rate.mockReturnValue({ success: false });
    expect((await POST(req())).status).toBe(
      reason === 'no-user'
        ? 401
        : reason === 'hidden'
          ? 404
          : reason === 'rate-limit'
            ? 429
            : 403
    );
    expect(h.upload).not.toHaveBeenCalled();
  }
);
it('uploads with caller RLS to a randomized account and conversation path', async () => {
  const response = await POST(req());
  expect(response.status).toBe(201);
  expect(h.upload).toHaveBeenCalledWith(
    expect.stringMatching(
      new RegExp(
        `^account-account-a/mobile-${conversationId}-[a-f0-9-]+\\.pdf$`
      )
    ),
    expect.any(Uint8Array),
    expect.objectContaining({ contentType: 'application/pdf', upsert: false })
  );
  expect(await response.json()).toMatchObject({
    kind: 'document',
    filename: 'notes.pdf',
  });
  expect(response.headers.get('access-control-allow-origin')).toBe(
    'https://localhost'
  );
});
it('accepts JPEG/PNG signatures and preserves an Arabic document name', async () => {
  const r = await POST(
    req(
      new File([new Uint8Array([255, 216, 255, 0])], 'photo.jpg', {
        type: 'image/jpeg',
      })
    )
  );
  expect(r.status).toBe(201);
  const a = await POST(
    req(new File(['%PDF-1.4'], 'ملاحظات.pdf', { type: 'application/pdf' }))
  );
  expect((await a.json()).filename).toBe('ملاحظات.pdf');
});
it.each([
  new File(['<html>bad</html>'], 'fake.pdf', { type: 'application/pdf' }),
  new File(['data'], 'app.apk', {
    type: 'application/vnd.android.package-archive',
  }),
  new File(['data'], 'notes.pdf', { type: 'text/html' }),
  new File([], 'empty.txt', { type: 'text/plain' }),
])('rejects unsupported or mismatched file content', async (file) => {
  expect((await POST(req(file))).status).toBe(400);
  expect(h.upload).not.toHaveBeenCalled();
});
it('bounds photo and multipart sizes before storage writes', async () => {
  expect(
    (
      await POST(
        req(
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'photo.jpg', {
            type: 'image/jpeg',
          })
        )
      )
    ).status
  ).toBe(413);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 65537));
      controller.close();
    },
  });
  const init = {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'multipart/form-data; boundary=fixture',
    },
    body,
    duplex: 'half',
  };
  expect((await POST(new Request('https://crm.test', init))).status).toBe(413);
  expect(h.upload).not.toHaveBeenCalled();
});
it('rejects malformed conversation IDs and reports storage failure without sending', async () => {
  expect((await POST(req(undefined, 'foreign'))).status).toBe(400);
  h.upload.mockResolvedValue({ error: { message: 'fixture' } });
  expect((await POST(req())).status).toBe(502);
});
