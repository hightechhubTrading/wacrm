import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  setState: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) =>
    harness.effects.push(effect),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    harness.setState,
  ],
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-1' }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: harness.createClient,
}));

import { usePresence } from './use-presence';

function database() {
  const channels = new Map<
    string,
    {
      on: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      callback?: (event: unknown) => void;
    }
  >();
  const client = {
    channel: vi.fn((topic: string) => {
      if (channels.has(topic)) return channels.get(topic)!;
      let subscribed = false;
      const channel = {
        on: vi.fn((_event, _filter, callback) => {
          if (subscribed)
            throw new Error('cannot add callbacks after subscribe()');
          channel.callback = callback;
          return channel;
        }),
        subscribe: vi.fn(() => {
          subscribed = true;
          return channel;
        }),
        callback: undefined as ((event: unknown) => void) | undefined,
      };
      channels.set(topic, channel);
      return channel;
    }),
    // Keep the channel registered to model asynchronous unsubscribe.
    removeChannel: vi.fn(() => Promise.resolve('ok')),
    from: vi.fn(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    })),
  };
  harness.createClient.mockReturnValue(client);
  return { client, channels };
}
function PresenceReader(enabled = true) {
  usePresence(enabled);
  return harness.effects.pop()!();
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.effects.length = 0;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('presence subscription lifecycle', () => {
  it('supports concurrent readers without reusing a subscribed channel', () => {
    const { client, channels } = database();
    const firstCleanup = PresenceReader();
    const secondCleanup = PresenceReader();
    expect(channels.size).toBe(2);
    for (const topic of channels.keys())
      expect(topic).toMatch(/^presence:account-1:/);
    firstCleanup?.();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(
      [...channels.values()][0]
    );
    expect([...channels.values()][1].subscribe).toHaveBeenCalledOnce();
    secondCleanup?.();
  });

  it('uses a fresh channel on effect replay while old unsubscribe is pending', () => {
    const { channels } = database();
    const cleanup = PresenceReader();
    cleanup?.();
    const remountCleanup = PresenceReader();
    expect(channels.size).toBe(2);
    remountCleanup?.();
  });

  it('ignores events delivered after the reader has been cleaned up', () => {
    const { channels } = database();
    const cleanup = PresenceReader();
    cleanup?.();
    harness.setState.mockClear();
    [...channels.values()][0].callback?.({
      eventType: 'UPDATE',
      new: {
        user_id: 'member',
        status: 'online',
        last_seen_at: new Date().toISOString(),
      },
    });
    expect(harness.setState).not.toHaveBeenCalled();
  });

  it('does not subscribe when disabled', () => {
    const { client } = database();
    PresenceReader(false);
    expect(client.channel).not.toHaveBeenCalled();
  });
});
