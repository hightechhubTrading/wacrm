import type { ConversationStatus } from '@/types';

export const CONVERSATION_WORK_STATUSES = [
  'new',
  'following_up',
  'preparing_quotation',
  'awaiting_customer',
  'site_visit',
  'installation',
  'maintenance',
  'completed',
  'cancelled',
] as const;
export type ConversationWorkStatus =
  (typeof CONVERSATION_WORK_STATUSES)[number];
export const WORK_STATUS_VIEWS = CONVERSATION_WORK_STATUSES.map(
  (value) => `work:${value}` as const
);
export function workStatusLifecycle(
  status: ConversationWorkStatus
): ConversationStatus {
  return status === 'completed' || status === 'cancelled'
    ? 'closed'
    : status === 'awaiting_customer'
      ? 'pending'
      : 'open';
}
export function isConversationWorkStatus(
  value: unknown
): value is ConversationWorkStatus {
  return CONVERSATION_WORK_STATUSES.includes(value as ConversationWorkStatus);
}
