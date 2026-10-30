import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUnreadCounter } from './unread-counter';
afterEach(() => vi.useRealTimers());
describe('unread snapshots and realtime', () => {
  it('reconciles unknown rows then updates known rows without more reads', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 1500),
      publish = vi.fn();
    const counter = createUnreadCounter(load, publish);
    await counter.refresh();
    counter.event({
      eventType: 'UPDATE',
      old: { id: 'one' },
      new: { id: 'one', unread_count: 3 },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(load).toHaveBeenCalledTimes(2);
    counter.event({
      eventType: 'UPDATE',
      old: { id: 'one' },
      new: { id: 'one', unread_count: 0 },
    });
    expect(publish).toHaveBeenLastCalledWith(1499);
    counter.event({
      eventType: 'UPDATE',
      old: { id: 'one' },
      new: { id: 'one', unread_count: 1 },
    });
    expect(publish).toHaveBeenLastCalledWith(1500);
    counter.event({ eventType: 'DELETE', old: { id: 'one' }, new: {} });
    expect(publish).toHaveBeenLastCalledWith(1499);
    expect(load).toHaveBeenCalledTimes(2);
    counter.stop();
  });
  it('coalesces bursts and rejects a snapshot crossed by realtime events', async () => {
    vi.useFakeTimers();
    let finish!: (n: number) => void;
    const load = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            finish = resolve;
          })
      ),
      publish = vi.fn();
    const counter = createUnreadCounter(load, publish);
    const pending = counter.refresh();
    await Promise.resolve();
    for (let n = 0; n < 10; n++)
      counter.event({
        eventType: 'INSERT',
        old: {},
        new: { id: String(n), unread_count: 1 },
      });
    finish(0);
    await pending;
    expect(publish).not.toHaveBeenCalled();
    load.mockResolvedValue(10);
    await vi.advanceTimersByTimeAsync(250);
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(10);
    counter.stop();
  });
  it('recovers counts on reconciliation and ignores disposed results', async () => {
    const load = vi.fn(async () => 7),
      publish = vi.fn();
    const counter = createUnreadCounter(load, publish);
    await counter.refresh();
    load.mockResolvedValue(2);
    await counter.refresh();
    expect(publish).toHaveBeenLastCalledWith(2);
    counter.stop();
    await counter.refresh();
    counter.event({
      eventType: 'INSERT',
      old: {},
      new: { id: 'late', unread_count: 1 },
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
