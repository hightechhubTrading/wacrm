import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ createClient: vi.fn(), decrypt: vi.fn(), getMediaUrl: vi.fn(), downloadMedia: vi.fn(), from: vi.fn(), visible: true, messageError: false, filters: {} as Record<string, string> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: h.decrypt }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: h.getMediaUrl, downloadMedia: h.downloadMedia }));
import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks(); h.visible = true; h.messageError = false; h.filters = {};
  h.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { if (table === 'messages') h.filters[key] = value; return query; },
      limit: () => query,
      maybeSingle: async () => table === 'profiles'
        ? { data: { account_id: 'dummy-account' }, error: null }
        : { data: h.visible ? { id: 'dummy-message' } : null, error: h.messageError ? { message: 'dummy failure' } : null },
      single: async () => ({ data: { access_token: 'dummy-encrypted' }, error: null }),
    };
    return query;
  });
  h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'dummy-user' } }, error: null }) }, from: h.from });
  h.decrypt.mockReturnValue('dummy-token');
  h.getMediaUrl.mockResolvedValue({ url: 'https://example.invalid/dummy', mimeType: 'image/png' });
  h.downloadMedia.mockResolvedValue({ buffer: Buffer.from('dummy'), contentType: 'image/png' });
});
const fetchMedia = (mediaId = '123456') => GET(new Request('http://localhost/api/whatsapp/media/' + mediaId), { params: Promise.resolve({ mediaId }) });
describe('media visibility boundary', () => {
  it.each(['missing', 'query-error'])('denies retained IDs when caller RLS returns %s', async (reason) => {
    h.visible = false; h.messageError = reason === 'query-error';
    expect((await fetchMedia()).status).toBe(404);
    expect(h.from).not.toHaveBeenCalledWith('whatsapp_config');
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.getMediaUrl).not.toHaveBeenCalled();
    expect(h.downloadMedia).not.toHaveBeenCalled();
  });
  it('returns visible media without permitting browser caching after reassignment', async () => {
    const response = await fetchMedia();
    expect(response.status).toBe(200);
    expect(h.filters.media_url).toBe('/api/whatsapp/media/123456');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('dummy');
  });
  it('rejects malformed provider IDs before accessing credentials', async () => {
    expect((await fetchMedia('../foreign')).status).toBe(400);
    expect(h.createClient).not.toHaveBeenCalled();
  });
});
