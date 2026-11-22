import { afterEach, expect, it, vi } from 'vitest';
import { createReconciler } from './reconcile';
afterEach(() => vi.useRealTimers());
it('discards a stale snapshot and serializes a new snapshot after an event', async () => {
  let finish!: (value: number) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((r) => {
          finish = r;
        })
    )
    .mockResolvedValue(7);
  const publish = vi.fn();
  const sync = createReconciler(load, publish);
  sync.refresh();
  sync.invalidate();
  finish(3);
  await new Promise((r) => setTimeout(r, 0));
  expect(publish.mock.calls).toEqual([[7]]);
  expect(load).toHaveBeenCalledTimes(2);
  sync.stop();
});
it('coalesces repeated events rather than counting duplicate reads', async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue(2),
    publish = vi.fn();
  const sync = createReconciler(load, publish);
  for (let i = 0; i < 100; i++) sync.invalidate();
  await vi.advanceTimersByTimeAsync(200);
  expect(load).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledWith(2);
  sync.stop();
});
it('does not publish after identity disposal even with an outstanding request', async () => {
  let finish!: (value: number) => void;
  const publish = vi.fn();
  const sync = createReconciler(
    () =>
      new Promise<number>((r) => {
        finish = r;
      }),
    publish
  );
  sync.refresh();
  sync.stop();
  finish(99);
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
});
it('preserves state on failure and recovers on the next refresh', async () => {
  const publish = vi.fn(),
    failure = vi.fn();
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(4);
  const sync = createReconciler(load, publish, failure);
  sync.refresh();
  await new Promise((r) => setTimeout(r, 0));
  expect(failure).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
  sync.refresh();
  await new Promise((r) => setTimeout(r, 0));
  expect(publish).toHaveBeenCalledWith(4);
  sync.stop();
});
