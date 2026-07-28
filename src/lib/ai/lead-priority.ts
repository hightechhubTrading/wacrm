import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Notify whoever should act on a conversation the model just flagged
 * as urgent (see PRIORITY_SENTINEL_* in defaults.ts) -- the assigned
 * agent if one exists, otherwise every admin+ member of the account
 * (mirrors notifyAdminsOfKeyError's escalation shape). Called only on
 * a transition INTO urgent, never on a repeat, by auto-reply.ts.
 */
export async function notifyUrgentLead(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    assignedAgentId: string | null
    reason: string | null
  },
): Promise<void> {
  const { accountId, conversationId, contactId, assignedAgentId, reason } = args

  let recipientIds: string[]
  if (assignedAgentId) {
    recipientIds = [assignedAgentId]
  } else {
    const { data: admins, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('account_role', ['owner', 'admin'])
    if (error || !admins) return
    recipientIds = admins.map((a: { user_id: string }) => a.user_id)
  }
  if (recipientIds.length === 0) return

  const rows = recipientIds.map((userId) => ({
    account_id: accountId,
    user_id: userId,
    type: 'urgent_lead' as const,
    conversation_id: conversationId,
    contact_id: contactId,
    title: 'Urgent conversation needs attention',
    body: reason || 'AI flagged this conversation as urgent.',
  }))
  await db.from('notifications').insert(rows)
}
