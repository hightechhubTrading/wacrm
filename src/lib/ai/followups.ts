import type { SupabaseClient } from '@supabase/supabase-js';

export const FOLLOWUP_KINDS = [
  'handoff',
  'quotation',
  'inspection',
  'repair',
  'location',
  'comparison',
  'document_review',
] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
export interface Followup {
  id: string;
  kind: FollowupKind;
  status: 'open' | 'acknowledged' | 'deferred' | 'completed' | 'cancelled';
  owner_id: string | null;
  source_message_id: string | null;
  due_at: string;
  requested_at: string | null;
  confirmed_at: string | null;
  completion_evidence: string | null;
}
export async function recordReplyEvent(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    triggerMessageId?: string;
    outcome: 'skipped' | 'sent' | 'handoff' | 'failed';
    reason: string;
  }
): Promise<void> {
  const row = {
    account_id: args.accountId,
    conversation_id: args.conversationId,
    trigger_message_id: args.triggerMessageId ?? null,
    outcome: args.outcome,
    reason: args.reason,
  };
  console.info('[ai reply]', row); // IDs and fixed reason codes only.
  try {
    const { error } = await db.from('ai_reply_events').insert(row);
    if (error) console.warn('[ai reply] event storage unavailable');
  } catch {
    console.warn('[ai reply] event storage unavailable');
  }
}
export async function ensureFollowup(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    sourceMessageId?: string;
    kind: FollowupKind;
    ownerId: string | null;
  }
): Promise<string | null> {
  try {
    const { data, error } = await db.rpc('ensure_ai_followup', {
      p_account_id: args.accountId,
      p_conversation_id: args.conversationId,
      p_source_message_id: args.sourceMessageId ?? null,
      p_kind: args.kind,
      p_owner_id: args.ownerId,
    });
    if (error || typeof data !== 'string') throw new Error('storage');
    return data;
  } catch {
    console.warn('[ai follow-up] storage unavailable');
    return null;
  }
}
export async function loadFollowups(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<Followup[]> {
  try {
    const { data, error } = await db
      .from('ai_followups')
      .select(
        'id,kind,status,owner_id,source_message_id,due_at,requested_at,confirmed_at,completion_evidence'
      )
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(20);
    return error ? [] : ((data ?? []) as Followup[]);
  } catch {
    return [];
  }
}

/** Validated human updates; requested dates never imply confirmed appointments. */
export function followupPatch(
  body: unknown,
  userId: string,
  now = new Date()
): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (
    !['acknowledged', 'deferred', 'completed', 'cancelled'].includes(
      String(b.status)
    )
  )
    return null;
  const patch: Record<string, unknown> = {
    status: b.status,
    updated_at: now.toISOString(),
  };
  if (b.status === 'acknowledged') patch.owner_id = userId;
  if (b.status === 'completed') {
    if (
      typeof b.completion_evidence !== 'string' ||
      b.completion_evidence.trim().length < 10 ||
      b.completion_evidence.length > 2000
    )
      return null;
    patch.completion_evidence = b.completion_evidence.trim();
    patch.completed_by = userId;
  }
  for (const field of ['due_at', 'requested_at', 'confirmed_at'] as const) {
    if (b[field] === undefined) continue;
    if (typeof b[field] !== 'string' || !Number.isFinite(Date.parse(b[field])))
      return null;
    patch[field] = new Date(b[field]).toISOString();
  }
  if (b.status === 'deferred') {
    if (
      typeof patch.due_at !== 'string' ||
      Date.parse(patch.due_at) <= now.getTime()
    )
      return null;
    patch.next_reminder_at = patch.due_at;
  } else if (patch.due_at) patch.next_reminder_at = patch.due_at;
  return patch;
}
