import { quotationPathValid } from './document-path';
import { NextResponse } from 'next/server';
import type { AccountContext } from '@/lib/auth/account';
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

export async function dispatchQuotation(
  ctx: Pick<AccountContext, 'supabase' | 'accountId' | 'userId'>,
  id: string,
  body: unknown
) {
  const input = body as {
    documentId?: string;
    conversationId?: string;
    caption?: string;
  } | null;
  const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
  if (!limit.success) return rateLimitResponse(limit);
  if (
    !input?.documentId ||
    !input?.conversationId ||
    typeof input.caption !== 'string'
  )
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  const { data: quotation, error: quotationError } = await ctx.supabase
    .from('quotations')
    .select('id,revision,workspace_version,pdf_storage_path')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (quotationError || !quotation)
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
  const { data: document } = await ctx.supabase
    .from('quotation_documents')
    .select('*')
    .eq('id', input.documentId)
    .eq('quotation_id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!document)
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (
    document.workspace_version !== quotation.workspace_version ||
    document.revision !== quotation.revision ||
    document.storage_path !== quotation.pdf_storage_path ||
    !quotationPathValid(id, quotation.revision, document.storage_path)
  )
    return NextResponse.json(
      {
        error: 'Quotation changed. Prepare the latest PDF.',
        code: 'quotationChanged',
      },
      { status: 409 }
    );
  const mediaUrl = ctx.supabase.storage
    .from('quotation-pdfs')
    .getPublicUrl(document.storage_path).data.publicUrl;
  validateSendMessageParams({
    messageType: 'document',
    contentText: input.caption,
    mediaUrl,
  });
  const { data: conversation } = await ctx.supabase
    .from('conversations')
    .select('id')
    .eq('id', input.conversationId)
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
    !Number.isFinite(Date.parse(lastInbound.created_at)) ||
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
        contentText: input.caption,
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
    const retryable = e instanceof SendMessageError && e.outcome === 'rejected';
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
}
