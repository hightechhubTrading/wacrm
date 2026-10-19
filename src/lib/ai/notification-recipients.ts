import type { SupabaseClient } from '@supabase/supabase-js';

/** Saved recipient IDs are hints; current account membership grants authority. */
export async function resolveNotificationRecipients(
  db: SupabaseClient,
  accountId: string,
  assignedAgentId: string | null
): Promise<string[]> {
  if (assignedAgentId) {
    const { data, error } = await db.from('profiles').select('user_id')
      .eq('account_id', accountId).eq('user_id', assignedAgentId)
      .in('account_role', ['owner', 'admin', 'agent']).maybeSingle();
    if (error) return [];
    if (data) return [data.user_id];
  }
  const { data, error } = await db.from('profiles').select('user_id')
    .eq('account_id', accountId).in('account_role', ['owner', 'admin']);
  return error || !data ? [] : data.map((member: { user_id: string }) => member.user_id);
}
