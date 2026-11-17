import type { MobileQuotationDetail } from '@/lib/quotations/mobile-types';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';
import {
  mobileQuotation,
  currentQuotationDocument,
} from '@/lib/mobile/quotations';
import { mobileResponse, mobilePreflight } from '@/lib/mobile/conversation';
export const OPTIONS = mobilePreflight;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const fail = (status: number, error: string) =>
    mobileResponse(request, Response.json({ error }, { status }));
  try {
    const access = await mobileQuotation(request, (await params).id);
    if ('response' in access) return access.response;
    const { db, profile, quotation: q } = access;
    const [items, document] = await Promise.all([
      db
        .from('quotation_items')
        .select(
          'id,position,item_type,description,description_ar,specification,qty,unit,unit_price,line_total'
        )
        .eq('quotation_id', q.id)
        .order('position')
        .order('id')
        .limit(500),
      currentQuotationDocument(access),
    ]);
    if (items.error) return fail(503, 'Quotation items could not be loaded');
    let conversation = null;
    const phone = String(q.client_phone ?? '').replace(/\D/g, '');
    if (phone) {
      const contact = await db
        .from('contacts')
        .select('id')
        .eq('account_id', profile.account_id)
        .eq('phone_normalized', phone)
        .limit(1)
        .maybeSingle();
      if (contact.error) return fail(503, 'Recipient could not be checked');
      if (contact.data) {
        const r = await db
          .from('conversations')
          .select('id')
          .eq('account_id', profile.account_id)
          .eq('contact_id', contact.data.id)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (r.error) return fail(503, 'Conversation could not be checked');
        conversation = r.data;
      }
    }
    const { accountId, pdfStoragePath, ...quotation } = mapQuotationRow(q);
    void accountId;
    void pdfStoragePath;
    return mobileResponse(
      request,
      Response.json({
        quotation,
        items: (items.data ?? []).map(mapQuotationItemRow),
        itemsLimit: 500,
        document: document
          ? {
              id: document.id,
              revision: document.revision,
              workspaceVersion: document.workspace_version,
              sendState: document.send_state,
              sentAt: document.sent_at,
              messageId: document.message_id,
            }
          : null,
        conversationId: conversation?.id ?? null,
      } satisfies MobileQuotationDetail)
    );
  } catch {
    return fail(503, 'Quotation details are temporarily unavailable');
  }
}
