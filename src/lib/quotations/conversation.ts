import type { SupabaseClient } from '@supabase/supabase-js';

export async function readQuotationConversation(
  db: SupabaseClient,
  accountId: string,
  id: string
) {
  const { data, error } = await db
    .from('conversations')
    .select('id,contact_id,contact:contacts!inner(phone,name,company)')
    .eq('account_id', accountId)
    .eq('contact.account_id', accountId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const contact = Array.isArray(data.contact) ? data.contact[0] : data.contact;
  return contact
    ? { id: data.id, contactId: data.contact_id, ...contact }
    : null;
}
