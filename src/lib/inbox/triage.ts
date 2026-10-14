import type { Conversation } from '@/types';
export const TRIAGE_GROUPS = [
  'priority',
  'unread',
  'active',
  'closed',
] as const;
export type TriageGroup = (typeof TRIAGE_GROUPS)[number];
export function triageGroup(conversation: Conversation): TriageGroup {
  if (conversation.status === 'closed') return 'closed';
  if (['urgent', 'high'].includes(conversation.ai_priority ?? ''))
    return 'priority';
  if (conversation.unread_count > 0) return 'unread';
  return 'active';
}
export function sortTriage(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const group =
      TRIAGE_GROUPS.indexOf(triageGroup(a)) -
      TRIAGE_GROUPS.indexOf(triageGroup(b));
    if (group) return group;
    if (triageGroup(a) === 'priority' && a.ai_priority !== b.ai_priority)
      return a.ai_priority === 'urgent' ? -1 : 1;
    const timestamp = (value?: string | null) => {
      const parsed = value ? Date.parse(value) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return timestamp(b.last_message_at) - timestamp(a.last_message_at);
  });
}
