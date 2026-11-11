import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  read: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  load: vi.fn(),
  normalize: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  requireRole: h.role,
}));
vi.mock('@/lib/quotations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ insert: h.insert, update: h.update }),
    storage: { from: () => ({ upload: h.upload }) },
  }),
}));
vi.mock('@/lib/quotations/reference-image-server', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/quotations/reference-image-server')
  >()),
  normalizeReferenceImage: h.normalize,
  loadReferenceImage: h.load,
}));
import { GET, POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
const id = '10000000-0000-4000-8000-000000000001';
const image = {
  storagePath: `${id}/20000000-0000-4000-8000-000000000001.jpg`,
  mimeType: 'image/jpeg',
  width: 640,
  height: 480,
  bytes: 3,
};
const params = { params: Promise.resolve({ id }) };
function request(body: BodyInit = 'abc', type = 'image/png') {
  return new Request(`http://localhost/api/quotations/${id}/image`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  const chain = { eq: h.eq, maybeSingle: h.read };
  h.eq.mockReturnValue(chain);
  h.read.mockResolvedValue({
    data: { id, status: 'draft', assigned_to: 'profile', image },
    error: null,
  });
  h.role.mockResolvedValue({
    supabase: { from: () => ({ select: () => chain }) },
    accountId: 'account',
    userId: 'user',
    role: 'admin',
  });
  h.insert.mockResolvedValue({ error: null });
  h.update.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  h.upload.mockResolvedValue({ error: null });
  h.normalize.mockResolvedValue({
    data: Buffer.from('abc'),
    width: 640,
    height: 480,
    bytes: 3,
    mimeType: 'image/jpeg',
  });
  h.load.mockResolvedValue(Buffer.from('abc'));
});
describe('quotation reference image endpoints', () => {
  it('rejects signed-out users and insufficient roles before privileged storage access', async () => {
    for (const error of [new UnauthorizedError(), new ForbiddenError()]) {
      h.role.mockRejectedValueOnce(error);
      expect((await POST(request(), params)).status).toBe(error.status);
    }
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('returns 404 for inaccessible quotations and prevents uploads to locked quotations', async () => {
    h.read.mockResolvedValueOnce({ data: null, error: null });
    expect((await POST(request(), params)).status).toBe(404);
    h.read.mockResolvedValueOnce({ data: { id, status: 'sent' }, error: null });
    expect((await POST(request(), params)).status).toBe(409);
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('requires the agent to be assigned to the quotation', async () => {
    h.role.mockResolvedValueOnce({
      supabase: { from: () => ({ select: () => ({ eq: h.eq }) }) },
      accountId: 'account',
      userId: 'user',
      role: 'agent',
    });
    h.read.mockResolvedValueOnce({
      data: { id, status: 'draft', assigned_to: 'other' },
      error: null,
    });
    h.read.mockResolvedValueOnce({ data: { id: 'profile' }, error: null });
    expect((await POST(request(), params)).status).toBe(403);
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('rejects unsupported types and bounded streamed bodies before normalization', async () => {
    expect((await POST(request('abc', 'image/svg+xml'), params)).status).toBe(
      400
    );
    expect(
      (await POST(request(new Uint8Array(5 * 1024 * 1024 + 1)), params)).status
    ).toBe(400);
    expect(h.normalize).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('registers, uploads immutable normalized bytes, then activates the picture without saving the draft', async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(201);
    const { image: uploaded } = await response.json();
    expect(uploaded.storagePath).toMatch(new RegExp(`^${id}/.*\\.jpg$`));
    expect(h.insert).toHaveBeenCalledWith({
      storage_path: uploaded.storagePath,
      quotation_id: id,
      account_id: 'account',
      image: uploaded,
    });
    expect(h.upload).toHaveBeenCalledWith(
      uploaded.storagePath,
      Buffer.from('abc'),
      expect.objectContaining({ upsert: false, contentType: 'image/jpeg' })
    );
    expect(h.update).toHaveBeenCalledWith({ ready: true });
    expect(h.insert.mock.invocationCallOrder[0]).toBeLessThan(
      h.upload.mock.invocationCallOrder[0]
    );
    expect(h.upload.mock.invocationCallOrder[0]).toBeLessThan(
      h.update.mock.invocationCallOrder[0]
    );
  });
  it('does not activate failed uploads or upload when registration fails', async () => {
    h.upload.mockResolvedValueOnce({ error: { message: 'failed' } });
    expect((await POST(request(), params)).status).toBe(503);
    expect(h.update).not.toHaveBeenCalled();
    h.upload.mockClear();
    h.insert.mockResolvedValueOnce({ error: { message: 'failed' } });
    expect((await POST(request(), params)).status).toBe(503);
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('serves private same-origin bytes only after quotation/account scoped reads', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/quotations/${id}/image?path=${encodeURIComponent(image.storagePath)}`
      ),
      params
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(h.eq).toHaveBeenCalledWith('quotation_id', id);
    expect(h.eq).toHaveBeenCalledWith('account_id', 'account');
    expect(h.eq).toHaveBeenCalledWith('ready', true);
    expect(h.load).toHaveBeenCalledWith(id, 'account', image);
  });
  it('does not download an image absent from the quotation registry', async () => {
    h.read
      .mockResolvedValueOnce({ data: { id, status: 'draft' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect(
      (await GET(new Request('http://localhost/image?path=foreign'), params))
        .status
    ).toBe(404);
    expect(h.load).not.toHaveBeenCalled();
  });
});
