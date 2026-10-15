import type { SupabaseClient } from '@supabase/supabase-js';
import type { Conversation } from '@/types';
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { sortTriage } from '@/lib/inbox/triage';
import type { FollowupKind } from '@/lib/ai/followups';
export interface AgendaTask {
  id: string;
  kind: FollowupKind;
  status: 'open' | 'acknowledged' | 'deferred';
  owner_id: string | null;
  due_at: string;
  conversation_id: string;
  conversation: { contact: { name?: string; phone: string } | null };
}
export interface AgendaData {
  conversations: Conversation[];
  priorityCount: number;
  unreadCount: number;
  attentionAvailable: boolean;
  tasks: AgendaTask[];
  taskCount: number;
  tasksAvailable: boolean;
  members: { user_id: string; full_name: string }[];
  membersAvailable: boolean;
}
export async function loadAgenda(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<AgendaData> {
  const [priority, unread, tasks, members] = await Promise.all([
    db
      .from('conversations')
      .select(CONVERSATION_SELECT, { count: 'exact' })
      .eq('account_id', accountId)
      .neq('status', 'closed')
      .in('ai_priority', ['urgent', 'high'])
      .order('ai_priority', { ascending: false })
      .order('last_message_at', { ascending: false })
      .limit(6),
    db
      .from('conversations')
      .select(CONVERSATION_SELECT, { count: 'exact' })
      .eq('account_id', accountId)
      .neq('status', 'closed')
      .gt('unread_count', 0)
      .order('last_message_at', { ascending: false })
      .limit(6),
    db
      .from('ai_followups')
      .select(
        'id,kind,status,owner_id,due_at,conversation_id,conversation:conversations!inner(contact:contacts(name,phone),status)',
        { count: 'exact' }
      )
      .eq('account_id', accountId)
      .in('status', ['open', 'acknowledged', 'deferred'])
      .in('conversation.status', ['open', 'pending'])
      .or(`owner_id.eq.${userId},owner_id.is.null`)
      .order('due_at', { ascending: true })
      .limit(6),
    db
      .from('profiles')
      .select('user_id,full_name')
      .eq('account_id', accountId)
      .order('full_name')
      .limit(6),
  ]);
  const conversations = [
    ...new Map(
      normalizeConversations([
        ...(priority.data ?? []),
        ...(unread.data ?? []),
      ]).map((c) => [c.id, c])
    ).values(),
  ];
  return {
    conversations: sortTriage(conversations).slice(0, 6),
    priorityCount: priority.count ?? 0,
    unreadCount: unread.count ?? 0,
    attentionAvailable: !priority.error && !unread.error,
    tasks: (tasks.data ?? []) as unknown as AgendaTask[],
    taskCount: tasks.count ?? 0,
    tasksAvailable: !tasks.error,
    members: members.data ?? [],
    membersAvailable: !members.error,
  };
}
