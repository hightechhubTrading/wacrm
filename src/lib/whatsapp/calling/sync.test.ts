import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCallingSync } from './sync';

afterEach(() => vi.useRealTimers());

function fixture(enabled = true) {
  vi.useFakeTimers();
  let active = false;
  const loadSettings = vi.fn(async () => enabled);
  const loadCalls = vi.fn(async () => {});
  const sync = createCallingSync({
    loadSettings,
    loadCalls,
    hasActiveCall: () => active,
  });
  sync.start();
  return {
    sync,
    loadCalls,
    loadSettings,
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

describe('calling reconciliation', () => {
  it('reduces scheduled healthy idle traffic by at least 70 percent', async () => {
    const f = fixture();
    f.sync.setRealtimeHealthy(true);
    await vi.advanceTimersByTimeAsync(0);
    f.loadCalls.mockClear();
    f.loadSettings.mockClear();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(
      f.loadCalls.mock.calls.length + f.loadSettings.mock.calls.length
    ).toBeLessThanOrEqual(25);
    f.sync.stop();
  });

  it('keeps fast fallback on disconnect and during active calls', async () => {
    const f = fixture();
    f.sync.setRealtimeHealthy(true);
    await vi.advanceTimersByTimeAsync(0);
    f.loadCalls.mockClear();
    f.sync.setRealtimeHealthy(false);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.loadCalls.mock.calls.length).toBeGreaterThanOrEqual(4);
    f.setActive(true);
    f.sync.setRealtimeHealthy(true);
    await vi.advanceTimersByTimeAsync(0);
    f.loadCalls.mockClear();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.loadCalls).toHaveBeenCalledTimes(3);
    f.sync.stop();
  });

  it('stops disabled idle reads and discovers settings activation', async () => {
    const f = fixture(false);
    await vi.advanceTimersByTimeAsync(0);
    f.loadCalls.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.loadCalls).not.toHaveBeenCalled();
    f.loadSettings.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.loadCalls).toHaveBeenCalled();
    f.sync.stop();
  });

  it('retains enabled state after a settings failure and reconciles active calls while disabled', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(0);
    f.loadSettings.mockRejectedValue(new Error('offline'));
    await f.sync.refreshSettings();
    f.loadCalls.mockClear();
    await f.sync.refresh();
    expect(f.loadCalls).toHaveBeenCalledOnce();
    f.loadSettings.mockResolvedValue(false);
    await f.sync.refreshSettings();
    f.setActive(true);
    f.loadCalls.mockClear();
    await f.sync.refresh();
    expect(f.loadCalls).toHaveBeenCalledOnce();
    f.sync.stop();
  });

  it('coalesces overlapping requests and ignores triggers after disposal', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(0);
    let finish!: () => void;
    f.loadCalls.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    f.loadCalls.mockClear();
    const pending = f.sync.refresh();
    void f.sync.refresh();
    void f.sync.refresh();
    expect(f.loadCalls).toHaveBeenCalledOnce();
    finish();
    await pending;
    expect(f.loadCalls).toHaveBeenCalledTimes(2);
    f.sync.stop();
    await f.sync.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.loadCalls).toHaveBeenCalledTimes(2);
  });
});
