import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureFollowup } from './followups';
import { notifyReplyReview } from './reply-review';
/** No customer sends. Interrupted transport is reviewed by staff, never blindly retried. */
export async function recoverStaleMediaActions(
  db: SupabaseClient,
  now = new Date()
) {
  const { data: rows, error } = await db
    .from('ai_media_actions')
    .select(
      'id,account_id,conversation_id,trigger_message_id,status,updated_at'
    )
    .in('status', ['pending', 'sending'])
    .lte('updated_at', new Date(now.getTime() - 10 * 60000).toISOString())
    .limit(30);
  if (error || !rows) return 0;
  let recovered = 0;
  for (const row of rows) {
    const status = row.status === 'sending' ? 'uncertain' : 'failed';
    const { data: claimed, error: claimError } = await db
      .from('ai_media_actions')
      .update({
        status,
        failure_code:
          row.status === 'sending'
            ? 'interrupted_transport'
            : 'interrupted_before_send',
      })
      .eq('id', row.id)
      .eq('account_id', row.account_id)
      .eq('status', row.status)
      .eq('updated_at', row.updated_at)
      .select('id')
      .maybeSingle();
    if (claimError || !claimed) continue;
    const { data: conv } = await db
      .from('conversations')
      .select('contact_id,assigned_agent_id')
      .eq('id', row.conversation_id)
      .eq('account_id', row.account_id)
      .maybeSingle();
    if (!conv) continue;
    await ensureFollowup(db, {
      accountId: row.account_id,
      conversationId: row.conversation_id,
      sourceMessageId: row.trigger_message_id,
      kind: 'document_review',
      ownerId: conv.assigned_agent_id,
    });
    await notifyReplyReview(db, {
      accountId: row.account_id,
      conversationId: row.conversation_id,
      contactId: conv.contact_id,
      ownerId: conv.assigned_agent_id,
      kind: 'media',
      reason: 'Interrupted attachment send: ' + status,
    });
    recovered++;
  }
  return recovered;
}
