import type { Message } from '@/types';
/** Consecutive messages share a caption only when their author and origin match. */
export function isMessageContinuation(
  previous: Message | undefined,
  current: Message
): boolean {
  if (
    !previous ||
    previous.sender_type !== current.sender_type ||
    previous.sender_id !== current.sender_id ||
    Boolean(previous.ai_generated) !== Boolean(current.ai_generated)
  )
    return false;
  const gap = Date.parse(current.created_at) - Date.parse(previous.created_at);
  return Number.isFinite(gap) && gap >= 0 && gap < 5 * 60 * 1000;
}
