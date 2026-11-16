import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const h = vi.hoisted(() => ({
  client: vi.fn(),
  admin: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  rate: vi.fn(),
  role: 'agent',
  user: true,
  visible: true,
  updateVisible: true,
  avatar: null as string | null,
  patch: null as { avatar_url: string | null } | null,
  filters: {} as Record<string, unknown>,
}));
vi.mock('@/lib/supabase/request', () => ({ createRequestClient: h.client }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.rate }));
import { GET, POST, DELETE, OPTIONS } from './route';
const id = '12345678-1234-4234-8234-123456789abc',
  version = '22345678-1234-4234-8234-123456789abc';
const avatar = `/api/contacts/${id}/photo?v=${version}`;
let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: { width: 640, height: 400, channels: 3, background: '#84a8bb' },
  })
    .png()
    .toBuffer();
});
beforeEach(() => {
  vi.resetAllMocks();
  h.role = 'agent';
  h.user = true;
  h.visible = true;
  h.updateVisible = true;
  h.avatar = null;
  h.patch = null;
  h.filters = {};
  h.rate.mockReturnValue({ success: true });
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
  h.download.mockResolvedValue({ data: new Blob(['fixture']), error: null });
  h.admin.mockReturnValue({
    storage: {
      from: () => ({
        upload: h.upload,
        download: h.download,
        remove: h.remove,
      }),
    },
  });
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
        eq: (k: string, v: unknown) => {
          h.filters[table + '.' + k] = v;
          return q;
        },
        is: (k: string, v: unknown) => {
          h.filters[table + '.' + k] = v;
          return q;
        },
        update: (patch: { avatar_url: string | null }) => {
          h.patch = patch;
          return q;
        },
        maybeSingle: async () =>
          table === 'profiles'
            ? {
                data: { account_id: 'account-a', account_role: h.role },
                error: null,
              }
            : h.patch
              ? { data: h.updateVisible ? { id } : null, error: null }
              : {
                  data: h.visible
                    ? { id, account_id: 'account-a', avatar_url: h.avatar }
                    : null,
                  error: null,
                },
      };
      return q;
    },
  });
});
function req(
  method = 'POST',
  body: BodyInit = new Uint8Array(png),
  headers: Record<string, string> = {}
) {
  return new Request(
    'https://crm.test/api/contacts/' +
      id +
      '/photo' +
      (method === 'GET' ? '?v=' + version : ''),
    {
      method,
      headers: {
        origin: 'https://localhost',
        authorization: 'Bearer fixture',
        'content-type': 'image/png',
        'if-match': JSON.stringify(h.avatar ? version : 'none'),
        ...headers,
      },
      ...(method === 'POST' ? { body } : {}),
    }
  );
}
const context = { params: Promise.resolve({ id }) };
it('requires current user, contact visibility and agent role before storage writes', async () => {
  h.user = false;
  expect((await POST(req(), context)).status).toBe(401);
  h.user = true;
  h.role = 'viewer';
  expect((await POST(req(), context)).status).toBe(403);
  h.role = 'agent';
  h.visible = false;
  expect((await POST(req(), context)).status).toBe(404);
  expect(h.admin).not.toHaveBeenCalled();
});
it('rejects foreign origins, malformed IDs and stale edits before storage writes', async () => {
  expect(
    (
      await POST(
        req('POST', new Uint8Array(png), { origin: 'https://foreign.invalid' }),
        context
      )
    ).status
  ).toBe(403);
  expect(
    (await POST(req(), { params: Promise.resolve({ id: 'bad' }) })).status
  ).toBe(400);
  expect(
    (
      await POST(
        req('POST', new Uint8Array(png), { 'if-match': '"old"' }),
        context
      )
    ).status
  ).toBe(409);
  expect(h.upload).not.toHaveBeenCalled();
});
it('resizes real image bytes and stores only a protected versioned URL', async () => {
  const r = await POST(req(), context);
  expect(r.status).toBe(200);
  const result = await r.json();
  expect(result.avatar_url).toMatch(
    new RegExp('^/api/contacts/' + id + '/photo\\?v=[a-f0-9-]+$')
  );
  expect(h.filters['contacts.account_id']).toBe('account-a');
  expect(h.filters['contacts.avatar_url']).toBe(null);
  expect(h.upload).toHaveBeenCalledWith(
    expect.stringMatching(
      new RegExp('^account-a/' + id + '/[a-f0-9-]+\\.webp$')
    ),
    expect.any(Buffer),
    expect.objectContaining({ contentType: 'image/webp', upsert: false })
  );
  const metadata = await sharp(h.upload.mock.calls[0][1]).metadata();
  expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
  expect(metadata.exif).toBeUndefined();
  expect(h.upload.mock.calls[0][1].length).toBeLessThan(65536);
});
it('serves a current private image after RLS checks, including to viewers', async () => {
  h.avatar = avatar;
  h.role = 'viewer';
  const r = await GET(req('GET'), context);
  expect(r.status).toBe(200);
  expect(h.download).toHaveBeenCalledWith(`account-a/${id}/${version}.webp`);
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(r.headers.get('content-type')).toBe('image/webp');
  expect(r.headers.get('access-control-allow-origin')).toBe(
    'https://localhost'
  );
});
it('denies stale versions and removed access before touching private storage', async () => {
  expect((await GET(req('GET'), context)).status).toBe(404);
  h.avatar = avatar;
  h.visible = false;
  expect((await GET(req('GET'), context)).status).toBe(404);
  expect(h.admin).not.toHaveBeenCalled();
});
it('removes only the current managed photo after clearing its contact reference', async () => {
  h.avatar = avatar;
  const r = await DELETE(req('DELETE'), context);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ avatar_url: null });
  expect(h.patch).toEqual({ avatar_url: null });
  expect(h.filters['contacts.avatar_url']).toBe(avatar);
  expect(h.remove).toHaveBeenCalledWith([`account-a/${id}/${version}.webp`]);
});
it('cleans up a new upload if access or version changes during conversion', async () => {
  h.updateVisible = false;
  const r = await POST(req(), context);
  expect(r.status).toBe(409);
  expect(h.remove).toHaveBeenCalledWith([h.upload.mock.calls[0][0]]);
});
it('keeps the previous reference when storage fails', async () => {
  h.upload.mockResolvedValue({ error: { message: 'fixture' } });
  expect((await POST(req(), context)).status).toBe(503);
  expect(h.patch).toBeNull();
});
it.each([
  '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  '<html>fake photo</html>',
  '',
])('rejects non-raster image bytes before storage', async (body) => {
  expect((await POST(req('POST', body), context)).status).toBe(400);
  expect(h.upload).not.toHaveBeenCalled();
});
it('enforces MIME, input size and per-user limits', async () => {
  expect(
    (
      await POST(
        req('POST', new Uint8Array(png), { 'content-type': 'image/svg+xml' }),
        context
      )
    ).status
  ).toBe(415);
  expect(
    (
      await POST(
        req('POST', '', { 'content-length': String(5 * 1024 * 1024 + 1) }),
        context
      )
    ).status
  ).toBe(413);
  h.rate.mockReturnValue({ success: false });
  expect((await POST(req(), context)).status).toBe(429);
  expect(h.upload).not.toHaveBeenCalled();
});
it('allows same-site cookie requests and restricted native preflight', async () => {
  const r = new Request('https://crm.test/api/contacts/' + id + '/photo', {
    method: 'DELETE',
    headers: { origin: 'https://crm.test', 'if-match': '"none"' },
  });
  expect((await DELETE(r, context)).status).toBe(200);
  expect(h.client).toHaveBeenCalledWith(r);
  expect((await OPTIONS(req('OPTIONS'))).status).toBe(204);
  expect(
    (
      await OPTIONS(
        req('OPTIONS', new Uint8Array(png), { origin: 'https://evil.test' })
      )
    ).status
  ).toBe(403);
});
