import type { SupabaseClient } from '@supabase/supabase-js';
import type { FollowupKind } from '@/lib/ai/followups';
import type { GroupWork } from '@/lib/jobs/workflow';

export interface AgendaTask {
  id: string;
  kind: FollowupKind;
  status: 'open' | 'acknowledged' | 'deferred';
  owner_id: string | null;
  due_at: string;
  conversation_id: string;
  conversation: { contact: { name?: string; phone: string } | null };
}
export interface AgendaReply {
  id: string;
  contact: { name: string | null; phone: string | null } | null;
  last_message_text: string | null;
  last_message_at: string;
}
export type AgendaWork = Pick<
  GroupWork,
  'id' | 'deal_id' | 'reference' | 'kind' | 'status' | 'due_at' | 'responsible'
> & { deal: { title: string } };
export interface AgendaData {
  replies: AgendaReply[];
  replyCount: number;
  repliesAvailable: boolean;
  tasks: AgendaTask[];
  taskCount: number;
  tasksAvailable: boolean;
  waiting: AgendaWork[];
  waitingCount: number;
  waitingAvailable: boolean;
  blocked: AgendaWork[];
  blockedCount: number;
  blockedAvailable: boolean;
  members: { user_id: string; full_name: string }[];
  membersAvailable: boolean;
}

/** Exclusive next local midnight; preserves the browser's calendar day across DST. */
export function agendaDayEnd(now = new Date()) {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return end.toISOString();
}

// A rejected request must not hide the other independent work lists.
async function read<T>(query: PromiseLike<T>) {
  try {
    return await query;
  } catch {
    return { data: null, count: null, error: { message: 'Unavailable' } };
  }
}

export async function loadAgenda(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  now = new Date()
): Promise<AgendaData> {
  const workColumns =
    'id,deal_id,reference,kind,status,due_at,responsible,deal:deals!inner(title)';
  const [replies, tasks, waiting, blocked, members] = await Promise.all([
    read(db.rpc('sales_today_replies', { p_account: accountId })),
    read(
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
        .lt('due_at', agendaDayEnd(now))
        .order('due_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(6)
    ),
    read(
      db
        .from('group_handoffs')
        .select(workColumns, { count: 'exact' })
        .eq('account_id', accountId)
        .in('status', ['waiting', 'in_progress', 'ready'])
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(6)
    ),
    read(
      db
        .from('group_handoffs')
        .select(workColumns, { count: 'exact' })
        .eq('account_id', accountId)
        .eq('status', 'blocked')
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(6)
    ),
    read(
      db
        .from('profiles')
        .select('user_id,full_name')
        .eq('account_id', accountId)
        .order('full_name')
        .limit(6)
    ),
  ]);
  return {
    replies: replies.data?.items ?? [],
    replyCount: replies.data?.count ?? 0,
    repliesAvailable: !replies.error && !!replies.data,
    tasks: (tasks.data ?? []) as unknown as AgendaTask[],
    taskCount: tasks.count ?? 0,
    tasksAvailable: !tasks.error,
    waiting: (waiting.data ?? []) as unknown as AgendaWork[],
    waitingCount: waiting.count ?? 0,
    waitingAvailable: !waiting.error,
    blocked: (blocked.data ?? []) as unknown as AgendaWork[],
    blockedCount: blocked.count ?? 0,
    blockedAvailable: !blocked.error,
    members: members.data ?? [],
    membersAvailable: !members.error,
  };
}
