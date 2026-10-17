import type { SupabaseClient } from '@supabase/supabase-js';
import type { Deal } from '@/types';

export interface SummaryConversation {
  id: string;
  contact_id: string;
  assigned_agent_id?: string | null;
  last_message_at: string | null;
  updated_at: string;
  ai_context_summary: string | null;
  ai_context_summary_at: string | null;
  ai_handoff_summary: string | null;
}
export interface AssistanceSummary {
  conversation_id: string;
  status: string;
  analysis: unknown;
  updated_at: string;
}
/** Use the linked conversation, or the customer's latest visible conversation.
 * Never borrow a different conversation's recap when an explicit link exists. */
export function attachDealSummaries(
  deals: Deal[],
  conversations: SummaryConversation[],
  assistance: AssistanceSummary[],
  profiles: {
    id: string;
    user_id: string;
    full_name: string | null;
    avatar_url: string | null;
  }[] = []
): Deal[] {
  const profilesByUser = new Map(
    profiles.map((profile) => [profile.user_id, profile])
  );
  const byId = new Map(
    conversations.map((conversation) => [conversation.id, conversation])
  );
  const byContact = new Map<string, SummaryConversation>();
  for (const conversation of conversations) {
    const previous = byContact.get(conversation.contact_id);
    if (
      !previous ||
      (conversation.last_message_at || conversation.updated_at) >
        (previous.last_message_at || previous.updated_at)
    )
      byContact.set(conversation.contact_id, conversation);
  }
  const briefs = new Map(
    assistance
      .filter((brief) => brief.status === 'ready')
      .map((brief) => [brief.conversation_id, brief])
  );
  return deals.map((deal) => {
    const conversation = deal.conversation_id
      ? byId.get(deal.conversation_id)
      : deal.contact_id
        ? byContact.get(deal.contact_id)
        : undefined;
    if (!conversation) return { ...deal, aiSummary: null };
    const owner = conversation.assigned_agent_id
      ? profilesByUser.get(conversation.assigned_agent_id)
      : null;
    const brief = briefs.get(conversation.id);
    const analysis = brief?.analysis;
    const briefText =
      analysis &&
      typeof analysis === 'object' &&
      'summary' in analysis &&
      typeof analysis.summary === 'string'
        ? analysis.summary.trim()
        : '';
    const context = conversation.ai_context_summary?.trim();
    const preferBrief =
      briefText &&
      (!context ||
        (brief?.updated_at || '') > (conversation.ai_context_summary_at || ''));
    const text = preferBrief
      ? briefText
      : context || conversation.ai_handoff_summary?.trim();
    const at = preferBrief
      ? brief!.updated_at
      : context
        ? conversation.ai_context_summary_at
        : null;
    return {
      ...deal,
      customerConversationId: conversation.id,
      conversationOwner: {
        userId: conversation.assigned_agent_id || null,
        profileId: owner?.id || null,
        fullName: owner?.full_name || null,
        avatarUrl: owner?.avatar_url || null,
      },
      aiSummary: text ? { text, at, conversationId: conversation.id } : null,
    };
  });
}

/** Batch existing recaps; no generation requests and no per-card reads. */
export async function loadDealSummaries(
  db: SupabaseClient,
  deals: Deal[]
): Promise<Deal[]> {
  const contacts = Array.from(
    new Set(
      deals.map((deal) => deal.contact_id).filter((id): id is string => !!id)
    )
  );
  const conversations: SummaryConversation[] = [];
  for (let start = 0; start < contacts.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db
        .from('conversations')
        .select(
          'id,contact_id,assigned_agent_id,last_message_at,updated_at,ai_context_summary,ai_context_summary_at,ai_handoff_summary'
        )
        .in('contact_id', contacts.slice(start, start + 100))
        .order('id')
        .range(offset, offset + 499);
      if (error)
        return deals.map((deal) => ({
          ...deal,
          aiSummary: null,
          aiSummaryUnavailable: true,
          conversationOwnerUnavailable: true,
        }));
      conversations.push(...((data || []) as SummaryConversation[]));
      if (!data || data.length < 500) break;
    }
  }
  const assistance: AssistanceSummary[] = [];
  for (let start = 0; start < conversations.length; start += 100) {
    const { data, error } = await db
      .from('ai_sales_assistance')
      .select('conversation_id,status,analysis,updated_at')
      .in(
        'conversation_id',
        conversations
          .slice(start, start + 100)
          .map((conversation) => conversation.id)
      )
      .eq('status', 'ready');
    if (!error) assistance.push(...((data || []) as AssistanceSummary[]));
  }
  const userIds = Array.from(
    new Set(
      conversations
        .map((conversation) => conversation.assigned_agent_id)
        .filter((id): id is string => !!id)
    )
  );
  const profiles: {
    id: string;
    user_id: string;
    full_name: string | null;
    avatar_url: string | null;
  }[] = [];
  for (let start = 0; start < userIds.length; start += 100) {
    const { data, error } = await db
      .from('profiles')
      .select('id,user_id,full_name,avatar_url')
      .in('user_id', userIds.slice(start, start + 100));
    if (!error) profiles.push(...(data || []));
  }
  return attachDealSummaries(deals, conversations, assistance, profiles);
}
