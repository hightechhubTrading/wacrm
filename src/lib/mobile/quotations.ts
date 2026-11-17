import { quotationPathValid } from '@/lib/quotations/document-path';
import { mobileAccount, mobileResponse } from './conversation';
import { isOperationId } from '@/lib/whatsapp/send-operations';
export const quoteColumns =
  'id,account_id,reference,revision,status,client_name,client_phone,client_company,subject,project_name,location,currency,subtotal,discount_amount,total,valid_until,delivery_terms,payment_terms,warranty_terms,pdf_storage_path,workspace_version,updated_at';
export async function mobileQuotation(request: Request, id: string) {
  const fail = (status: number, error: string) => ({
    response: mobileResponse(request, Response.json({ error }, { status })),
  });
  const access = await mobileAccount(request);
  if ('response' in access) return access;
  if (!isOperationId(id)) return fail(400, 'Invalid quotation');
  const { data: quotation, error } = await access.db
    .from('quotations')
    .select(quoteColumns)
    .eq('id', id)
    .eq('account_id', access.profile.account_id)
    .maybeSingle();
  if (error || !quotation) return fail(404, 'Quotation unavailable');
  return { ...access, quotation };
}
export async function currentQuotationDocument(
  access: Exclude<
    Awaited<ReturnType<typeof mobileQuotation>>,
    { response: Response }
  >
) {
  const { quotation: q, db, profile } = access;
  if (!quotationPathValid(q.id, q.revision, q.pdf_storage_path)) return null;
  const { data, error } = await db
    .from('quotation_documents')
    .select(
      'id,workspace_version,revision,storage_path,send_state,sent_at,message_id'
    )
    .eq('quotation_id', q.id)
    .eq('account_id', profile.account_id)
    .eq('storage_path', q.pdf_storage_path)
    .eq('workspace_version', q.workspace_version ?? 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw Error('Document lookup failed');
  if (data && data.revision === q.revision && data.send_state !== 'legacy')
    return data;
  // Older, unversioned PDFs are viewable, but are not dispatchable through
  // the document-send ledger. Preparing a current PDF in CRM enables sending.
  if (
    (q.workspace_version ?? 0) === 0 &&
    q.pdf_storage_path === `${q.id}/rev-${q.revision}.pdf`
  )
    return {
      id: null,
      workspace_version: 0,
      revision: q.revision,
      storage_path: q.pdf_storage_path,
      send_state: 'legacy',
      sent_at: null,
      message_id: null,
    };
  return null;
}
