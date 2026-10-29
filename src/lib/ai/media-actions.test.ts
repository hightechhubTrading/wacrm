import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTrackedMedia } from './media-actions';
const h = vi.hoisted(() => ({
  item: vi.fn(),
  products: vi.fn(),
  send: vi.fn(),
}));
vi.mock('./media-library', () => ({
  getProductMediaItem: h.item,
  listProductsForPrompt: h.products,
}));
vi.mock('@/lib/flows/meta-send', () => ({ engineSendMedia: h.send }));
const args = {
  accountId: 'a',
  conversationId: 'c',
  contactId: 'contact',
  userId: 'u',
  triggerMessageId: 'trigger',
  fileId: 'file',
};
function database() {
  let row: Record<string, unknown> | null = null;
  const from = () => {
    let operation = 'read';
    let payload: Record<string, unknown> = {};
    const filters: [string, unknown][] = [];
    const execute = () => {
      if (operation === 'upsert') {
        if (row) return { data: [], error: null };
        row = { id: 'action', status: 'pending', ...payload };
        return { data: [row], error: null };
      }
      if (!row || !filters.every(([k, v]) => row![k] === v))
        return { data: null, error: null };
      if (operation === 'update') Object.assign(row, payload);
      return { data: row, error: null };
    };
    const chain = {
      upsert: (data: Record<string, unknown>) => {
        operation = 'upsert';
        payload = data;
        return chain;
      },
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return chain;
      },
      update: (data: Record<string, unknown>) => {
        operation = 'update';
        payload = data;
        return chain;
      },
      maybeSingle: async () => execute(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve),
    };
    return chain;
  };
  return {
    db: {
      from,
      storage: {
        from: () => ({
          getPublicUrl: () => ({
            data: { publicUrl: 'https://example.test/image' },
          }),
        }),
      },
    } as unknown as SupabaseClient,
    row: () => row,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.item.mockResolvedValue({
    productId: 'product',
    storagePath: 'image',
    mediaKind: 'image',
  });
  h.products.mockResolvedValue([{ id: 'product', files: [{ id: 'file' }] }]);
  h.send.mockResolvedValue({ whatsapp_message_id: 'provider-id' });
});
it('records provider acceptance and prevents a duplicate transport call', async () => {
  const { db, row } = database();
  expect(await sendTrackedMedia(db, args)).toBe('accepted');
  expect(row()).toMatchObject({
    status: 'accepted',
    provider_message_id: 'provider-id',
  });
  expect(await sendTrackedMedia(db, args)).toBe('skipped');
  expect(h.send).toHaveBeenCalledTimes(1);
});
it('records uncertain transport outcomes without retrying a possibly accepted send', async () => {
  h.send.mockRejectedValue(
    new Error('timeout after provider may have accepted')
  );
  const { db, row } = database();
  expect(await sendTrackedMedia(db, args)).toBe('uncertain');
  expect(row()).toMatchObject({
    status: 'uncertain',
    failure_code: 'transport_result_unknown',
  });
  expect(await sendTrackedMedia(db, args)).toBe('skipped');
  expect(h.send).toHaveBeenCalledTimes(1);
});
it('retries only a pre-send metadata lookup once', async () => {
  h.item.mockResolvedValueOnce(null);
  const { db } = database();
  expect(await sendTrackedMedia(db, args)).toBe('accepted');
  expect(h.item).toHaveBeenCalledTimes(2);
  expect(h.send).toHaveBeenCalledTimes(1);
});
it('blocks an unavailable or no longer approved asset before transport', async () => {
  h.products.mockResolvedValue([]);
  const { db, row } = database();
  expect(await sendTrackedMedia(db, args)).toBe('failed');
  expect(row()).toMatchObject({
    status: 'failed',
    failure_code: 'asset_unavailable',
  });
  expect(h.send).not.toHaveBeenCalled();
});
