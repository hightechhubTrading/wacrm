import type { SupabaseClient } from '@supabase/supabase-js';
/** Staff-only reminders: no customer sends and no automatic changes to AI ownership. */
export async function remindDueFollowups(
  db: SupabaseClient,
  now = new Date()
): Promise<number> {
  const { data: due, error } = await db
    .from('ai_followups')
    .select('id,account_id,conversation_id,owner_id,kind,next_reminder_at')
    .in('status', ['open', 'acknowledged', 'deferred'])
    .lte('next_reminder_at', now.toISOString())
    .lte('due_at', now.toISOString())
    .order('next_reminder_at', { ascending: true })
    .limit(50);
  if (error || !due) return 0;
  let sent = 0;
  for (const task of due) {
    const retryAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const { data: claim, error: claimError } = await db
      .from('ai_followups')
      .update({ next_reminder_at: retryAt })
      .eq('id', task.id)
      .eq('next_reminder_at', task.next_reminder_at)
      .in('status', ['open', 'acknowledged', 'deferred'])
      .select('id')
      .maybeSingle();
    if (claimError || !claim) continue;
    // Resolve current ownership; a reassigned conversation must not notify the old owner.
    const { data: conv } = await db
      .from('conversations')
      .select('assigned_agent_id,contact_id')
      .eq('id', task.conversation_id)
      .eq('account_id', task.account_id)
      .maybeSingle();
    if (!conv) continue;
    let recipients: string[] = [];
    const owner = conv.assigned_agent_id ?? task.owner_id;
    if (owner) {
      const { data: member } = await db
        .from('profiles')
        .select('user_id')
        .eq('user_id', owner)
        .eq('account_id', task.account_id)
        .in('account_role', ['agent', 'admin', 'owner'])
        .maybeSingle();
      if (member) recipients = [member.user_id];
    }
    if (!recipients.length) {
      const { data: admins } = await db
        .from('profiles')
        .select('user_id')
        .eq('account_id', task.account_id)
        .in('account_role', ['admin', 'owner']);
      recipients = (admins ?? []).map((m) => m.user_id);
    }
    if (!recipients.length) continue;
    // Recheck after lookups: completion or deferral may have raced the claim.
    const { data: fresh } = await db
      .from('ai_followups')
      .select('status,due_at')
      .eq('id', task.id)
      .maybeSingle();
    if (
      !fresh ||
      !['open', 'acknowledged', 'deferred'].includes(fresh.status) ||
      Date.parse(fresh.due_at) > now.getTime()
    )
      continue;
    const { error: noticeError } = await db.from('notifications').insert(
      recipients.map((userId) => ({
        account_id: task.account_id,
        user_id: userId,
        conversation_id: task.conversation_id,
        contact_id: conv.contact_id,
        type: 'ai_handoff',
        title: 'Customer follow-up needs attention',
        body: `Pending ${task.kind.replaceAll('_', ' ')}. Open the conversation to acknowledge, complete or defer the task.`,
      }))
    );
    if (!noticeError) {
      sent++;
      await db
        .from('ai_followups')
        .update({
          next_reminder_at: new Date(
            now.getTime() + 24 * 60 * 60 * 1000
          ).toISOString(),
        })
        .eq('id', task.id)
        .eq('next_reminder_at', retryAt);
    }
  }
  return sent;
}
