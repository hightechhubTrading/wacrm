import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  client: vi.fn(),
  media: vi.fn(),
  download: vi.fn(),
  decrypt: vi.fn(),
  fetch: vi.fn(),
  authenticated: true,
  profile: true,
  visible: true,
  queryError: false,
  source: '/api/whatsapp/media/123',
  kind: 'image',
  filters: {} as Record<string, string>,
  from: vi.fn(),
}));
vi.mock('@/lib/supabase/request', () => ({ createRequestClient: h.client }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: h.media,
  downloadMedia: h.download,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: h.decrypt }));
import { GET, OPTIONS } from './route';
const id = '12345678-1234-1234-1234-123456789abc';
function request(
  headers: Record<string, string> = {
    authorization: 'Bearer fixture-token',
    origin: 'https://localhost',
  }
) {
  return new Request(`https://crm.test/api/mobile/media/${id}`, { headers });
}
const read = (r = request(), messageId = id) =>
  GET(r, { params: Promise.resolve({ messageId }) });
beforeEach(() => {
  vi.resetAllMocks();
  h.authenticated = true;
  h.profile = true;
  h.visible = true;
  h.queryError = false;
  h.source = '/api/whatsapp/media/123';
  h.kind = 'image';
  h.filters = {};
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
  vi.stubGlobal('fetch', h.fetch);
  h.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        h.filters[`${table}.${key}`] = value;
        return query;
      },
      maybeSingle: async () =>
        table === 'profiles'
          ? {
              data: h.profile ? { account_id: 'account-a' } : null,
              error: null,
            }
          : {
              data: h.visible
                ? { media_url: h.source, content_type: h.kind }
                : null,
              error: h.queryError ? {} : null,
            },
      single: async () => ({
        data: { access_token: 'encrypted' },
        error: null,
      }),
    };
    return query;
  });
  h.client.mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: { user: h.authenticated ? { id: 'user-a' } : null },
        error: null,
      }),
    },
    from: h.from,
  });
  h.decrypt.mockReturnValue('provider-token');
  h.media.mockResolvedValue({
    url: 'https://provider.invalid/file',
    mimeType: 'image/jpeg',
  });
  h.download.mockResolvedValue({
    buffer: Buffer.from('image-fixture'),
    contentType: 'image/jpeg',
  });
  h.fetch.mockResolvedValue(
    new Response('public-fixture', {
      headers: { 'content-type': 'application/pdf' },
    })
  );
});
describe('mobile attachment access', () => {
  it.each<Record<string, string>>([{}, { authorization: 'garbage' }])(
    'requires a bearer session',
    async (headers) => {
      expect((await read(request(headers))).status).toBe(401);
      expect(h.client).not.toHaveBeenCalled();
    }
  );
  it('rejects foreign origins and malformed IDs before database access', async () => {
    expect(
      (
        await read(
          request({
            authorization: 'Bearer fixture',
            origin: 'https://foreign.test',
          })
        )
      ).status
    ).toBe(403);
    expect((await read(request(), '../bad')).status).toBe(400);
    expect(h.client).not.toHaveBeenCalled();
  });
  it('validates the user and account', async () => {
    h.authenticated = false;
    expect((await read()).status).toBe(401);
    h.authenticated = true;
    h.profile = false;
    expect((await read()).status).toBe(403);
    expect(h.media).not.toHaveBeenCalled();
  });
  it.each(['missing', 'query error'])(
    'denies retained message IDs on %s',
    async (reason) => {
      h.visible = false;
      h.queryError = reason === 'query error';
      expect((await read()).status).toBe(404);
      expect(h.from).not.toHaveBeenCalledWith('whatsapp_config');
      expect(h.decrypt).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    }
  );
  it('returns authorized Meta media with no-store and scoped CORS', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-fixture');
    expect(h.filters['messages.id']).toBe(id);
    expect(h.filters['whatsapp_config.account_id']).toBe('account-a');
    expect(h.download).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 16777216, timeoutMs: 20000 })
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://localhost'
    );
    expect(response.headers.get('content-disposition')).toBe('attachment');
  });
  it.each([
    'https://evil.test/file',
    'http://fixture.supabase.co/storage/v1/object/public/chat-media/a',
    'https://fixture.supabase.co/auth/v1/user',
    'https://fixture.supabase.co/storage/v1/object/public/private-bucket/a',
  ])('does not proxy an arbitrary source: %s', async (source) => {
    h.source = source;
    expect((await read()).status).toBe(422);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('fetches approved public storage without forwarding credentials or redirects', async () => {
    h.source =
      'https://fixture.supabase.co/storage/v1/object/public/chat-media/account-a/document.pdf';
    h.kind = 'document';
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('public-fixture');
    expect(h.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'error', cache: 'no-store' })
    );
    expect(h.fetch.mock.calls[0][1]).not.toHaveProperty('headers');
    expect(h.decrypt).not.toHaveBeenCalled();
  });
  it('bounds streamed public attachments without relying on Content-Length', async () => {
    h.source =
      'https://fixture.supabase.co/storage/v1/object/public/chat-media/a';
    h.fetch.mockResolvedValue(new Response(new Uint8Array(16777217)));
    expect((await read()).status).toBe(413);
  });
  it('supports the existing quotation PDF bucket', async () => {
    h.source =
      'https://fixture.supabase.co/storage/v1/object/public/quotation-pdfs/account-a/quote.pdf';
    h.kind = 'document';
    expect((await read()).status).toBe(200);
  });
  it('returns authorized voice recordings through the same RLS boundary', async () => {
    h.kind = 'audio';
    h.download.mockResolvedValue({
      buffer: Buffer.from('OggS fixture'),
      contentType: 'audio/ogg',
    });
    const r = await read();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/ogg');
  });
  it('returns a bounded failure for provider oversize and unsupported kinds', async () => {
    h.download.mockRejectedValue(new Error('Media exceeds limit'));
    expect((await read()).status).toBe(413);
    h.kind = 'video';
    expect((await read()).status).toBe(404);
  });
  it('only allows the native preflight origin', async () => {
    expect((await OPTIONS(request())).status).toBe(204);
    expect(
      (await OPTIONS(request({ origin: 'https://foreign.test' }))).status
    ).toBe(403);
  });
});
