import { supabaseAdmin } from './admin-client';

export async function getNextQuotationReference(accountId: string, code: string): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc('next_quotation_reference', {
    p_account_id: accountId,
    p_code: code,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
