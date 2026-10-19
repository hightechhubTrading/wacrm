import type { SupabaseClient } from '@supabase/supabase-js';

/** Service-role senders must bind all three identifiers before using a token. */
export async function requireConversationScope(
  db: SupabaseClient,
  args: { conversationId: string; accountId: string; contactId: string }
): Promise<void> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .maybeSingle();
  if (error || !data) throw new Error('conversation not found for this account and contact');
}
