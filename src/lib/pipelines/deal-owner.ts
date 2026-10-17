import type { Deal } from '@/types';
/** Conversation ownership is authoritative whenever the card resolves a chat.
 * Keep the persisted deal owner untouched: it is also used by deal RLS. */
export function getPipelineOwner(deal: Deal) {
  if (deal.conversationOwner) {
    const owner = deal.conversationOwner;
    return {
      unavailable: !!deal.conversationOwnerUnavailable,
      id: owner.userId ? owner.profileId || `user:${owner.userId}` : null,
      profileId: owner.profileId,
      userId: owner.userId,
      name: owner.fullName,
      source: 'conversation' as const,
    };
  }
  return {
    unavailable: !!deal.conversationOwnerUnavailable,
    id: deal.assigned_to || null,
    profileId: deal.assigned_to || null,
    userId: deal.assignee?.user_id || null,
    name: deal.assignee?.full_name || null,
    source: 'deal' as const,
  };
}
