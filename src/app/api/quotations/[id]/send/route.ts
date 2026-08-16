// Deliberately does NOT call sendMediaMessage/sendMessageToConversation.
// Those functions (src/lib/whatsapp/meta-api.ts) POST straight to Meta
// and dispatch immediately — there is no "pending, awaiting
// confirmation" state anywhere in this codebase's outbound-message
// path. Calling either directly from "Send Quotation" would silently
// auto-send, contradicting the "rep confirms before send" decision.
// This route only resolves where the PDF should be attached; a human
// always does the actual sending, in the existing inbox UI, unmodified
// by this feature.
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/send
 *
 * Same RLS-backed visibility check as the other quotation routes
 * (Task 6): ctx.supabase, not the admin client, 404 when the row
 * isn't visible to the caller. resolveConversationByPhone also runs
 * against ctx.supabase, matching every other caller of it in this
 * codebase (src/app/api/v1/messages/route.ts) — not the admin client.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: quotation, error } = await ctx.supabase
      .from('quotations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!quotation.pdf_storage_path) {
      return NextResponse.json({ error: 'Generate the PDF before sending' }, { status: 400 });
    }

    const conversation = await resolveConversationByPhone(
      ctx.supabase,
      quotation.account_id,
      quotation.client_phone,
      quotation.client_name,
    );

    const { data: pdfUrlData } = ctx.supabase.storage
      .from('quotation-pdfs')
      .getPublicUrl(quotation.pdf_storage_path);

    // Same cache-busting as generateQuotationPdf (src/lib/quotations/pdf.ts)
    // — storagePath is fixed per revision, so a stale cached copy from an
    // earlier view could otherwise get attached and sent to a client.
    // Timestamped at send-click time, not generation time, which is
    // correct here: this route always wants whatever's live right now.
    const pdfUrl = `${pdfUrlData.publicUrl}?v=${Date.now()}`;

    return NextResponse.json({
      conversationId: conversation.conversationId,
      inboxUrl: `/inbox?c=${conversation.conversationId}`,
      pdfUrl,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
