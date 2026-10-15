import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  sendMessageToConversation,
  SendMessageError,
  validateSendMessageParams,
} from '@/lib/whatsapp/send-message';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (
      !body?.documentId ||
      !body?.conversationId ||
      typeof body.caption !== 'string'
    )
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    const { data: document } = await ctx.supabase
      .from('quotation_documents')
      .select('*')
      .eq('id', body.documentId)
      .eq('quotation_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!document)
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    const mediaUrl = ctx.supabase.storage
      .from('quotation-pdfs')
      .getPublicUrl(document.storage_path).data.publicUrl;
    validateSendMessageParams({
      messageType: 'document',
      contentText: body.caption,
      mediaUrl,
    });
    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', body.conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!conversation)
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    // Free-form document messages require an open customer service window.
    const { data: lastInbound } = await ctx.supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      !lastInbound ||
      Date.now() - Date.parse(lastInbound.created_at) > 24 * 60 * 60 * 1000
    )
      return NextResponse.json(
        {
          error:
            'The WhatsApp session has expired. Ask the customer to reply first.',
        },
        { status: 400 }
      );
    const { data: claim, error: claimError } = await ctx.supabase.rpc(
      'claim_quotation_send',
      { p_document_id: document.id, p_conversation_id: conversation.id }
    );
    if (claimError)
      return NextResponse.json(
        { error: claimError.message, code: 'sendUncertain' },
        { status: 409 }
      );
    if (claim?.alreadySent)
      return NextResponse.json({
        success: true,
        alreadySent: true,
        message_id: claim.messageId,
      });
    try {
      const result = await sendMessageToConversation(
        ctx.supabase,
        ctx.accountId,
        {
          conversationId: conversation.id,
          messageType: 'document',
          mediaUrl,
          contentText: body.caption,
          filename: `${document.snapshot.reference}-rev-${document.revision}.pdf`,
        }
      );
      const { error } = await supabaseAdmin().rpc('complete_quotation_send', {
        p_document_id: document.id,
        p_message_id: result.messageId,
      });
      if (error) {
        console.error('Quotation delivery recording failed:', error.message);
        return NextResponse.json({
          success: true,
          message_id: result.messageId,
          recordingPending: true,
        });
      }
      return NextResponse.json({ success: true, message_id: result.messageId });
    } catch (e) {
      // Known Meta rejections are safe to retry. Network/persistence failures
      // may occur after Meta accepted the message: keep the claim to stop duplicates.
      const retryable =
        e instanceof SendMessageError &&
        [
          'bad_request',
          'forbidden',
          'not_found',
          'not_configured',
          'meta_error',
        ].includes(e.code);
      await supabaseAdmin()
        .from('quotation_documents')
        .update({ send_state: retryable ? 'ready' : 'uncertain' })
        .eq('id', document.id)
        .eq('send_state', 'sending');
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : 'Send failed',
          code: retryable ? 'sendFailed' : 'sendUncertain',
        },
        { status: 502 }
      );
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
