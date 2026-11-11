import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
  deleteRow: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: h.rpc,
    storage: { from: () => ({ remove: h.remove }) },
    from: () => ({ delete: h.deleteRow }),
  }),
}));
import { cleanupQuotationImages } from './reference-image-cleanup';
beforeEach(() => {
  vi.clearAllMocks();
  h.rpc.mockResolvedValue({
    data: [{ storage_path: 'old/path.jpg' }],
    error: null,
  });
  h.remove.mockResolvedValue({ error: null });
  h.deleteRow.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue({
    eq: h.eq,
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  });
});
it('deletes storage before deleting the tombstone and keeps failures retryable', async () => {
  h.remove.mockResolvedValueOnce({ error: { message: 'offline' } });
  await cleanupQuotationImages();
  expect(h.deleteRow).not.toHaveBeenCalled();
  await cleanupQuotationImages();
  expect(h.remove).toHaveBeenCalledWith(['old/path.jpg']);
  expect(h.deleteRow).toHaveBeenCalledOnce();
  expect(h.eq).toHaveBeenCalledWith('deleting', true);
});
it('does not remove objects when cleanup cannot safely claim them', async () => {
  h.rpc.mockResolvedValueOnce({ error: { message: 'missing' } });
  await expect(cleanupQuotationImages()).rejects.toThrow();
  expect(h.remove).not.toHaveBeenCalled();
});
