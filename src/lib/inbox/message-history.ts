import type { Message } from '@/types';

export const MESSAGE_PAGE_SIZE = 50;

/** Keep realtime/optimistic messages and already fetched history on resync. */
export function mergeMessageHistory(
  current: Message[],
  incoming: Message[]
): Message[] {
  const merged = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, message);
  return [...merged.values()].sort(
    (a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
      a.id.localeCompare(b.id)
  );
}
