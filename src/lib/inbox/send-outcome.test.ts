import { afterEach, expect, it, vi } from 'vitest';
import { reconcileSend, sendTrackedMessage } from './send-outcome';
afterEach(() => vi.unstubAllGlobals());
it('reconciles a dropped POST response instead of sending a second time', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('network lost'))
    .mockResolvedValueOnce(
      Response.json({
        outcome: 'accepted',
        message_id: 'saved',
        whatsapp_message_id: 'wamid',
      })
    );
  vi.stubGlobal('fetch', fetch);
  expect(
    await sendTrackedMessage(
      { conversation_id: 'A', content_text: 'hello' },
      'operation'
    )
  ).toEqual({
    state: 'accepted',
    messageId: 'saved',
    whatsappMessageId: 'wamid',
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(fetch.mock.calls[1][0]).toContain('?operation_id=operation');
  expect(fetch.mock.calls[1][1].method).toBeUndefined();
});
it('retains uncertainty for missing, inaccessible or unavailable operations', async () => {
  for (const response of [
    Response.json({ outcome: 'unknown', code: 'not_found' }),
    Response.json({}, { status: 403 }),
    Response.json({}, { status: 503 }),
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect((await reconcileSend('operation')).state).toBe('unknown');
  }
});
it('only allows a new send after a definite rejection', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { outcome: 'rejected', code: 'meta_rejected' },
        { status: 502 }
      )
    );
  vi.stubGlobal('fetch', fetch);
  expect(await sendTrackedMessage({}, 'operation')).toEqual({
    state: 'rejected',
    code: 'meta_rejected',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not equate an unclassified server error with a rejection', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: 'server failed' }, { status: 500 })
    )
    .mockResolvedValueOnce(Response.json({ outcome: 'unknown' }));
  vi.stubGlobal('fetch', fetch);
  expect((await sendTrackedMessage({}, 'operation')).state).toBe('unknown');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not reconcile conflicting content against an older accepted operation', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ outcome: 'unknown' }, { status: 409 })
    )
    .mockResolvedValueOnce(Response.json({ outcome: 'accepted' }));
  vi.stubGlobal('fetch', fetch);
  expect(
    await sendTrackedMessage({ content_text: 'different' }, 'reused-id')
  ).toEqual({ state: 'unknown', code: 'operation_conflict' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
