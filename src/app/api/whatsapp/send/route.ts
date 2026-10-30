import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  isOperationId,
  claimSendOperation,
  operationResponse,
  sendFingerprint,
  settleSendOperation,
  type SendOperation,
} from '@/lib/whatsapp/send-operations';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';

// The dashboard's outbound-send endpoint. It owns auth, per-user rate
// limiting, and the two ways the UI targets a thread — an existing
// `conversation_id` (inbox) or a `contact_id` (Contact detail →
// find-or-create the conversation). The actual Meta plumbing (validate
// → send → persist → pause flows) lives in the shared
// `sendMessageToConversation` core, which the public `/api/v1/messages`
// endpoint reuses. This route is a thin adapter: resolve the
// conversation, delegate, then map `SendMessageError` back onto the
// dashboard's internal `{ error }` shape.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    // Resolve the caller's account_id. Every downstream lookup
    // (conversation, whatsapp_config, message_templates) is account-
    // scoped post-multi-user, so the previous `user_id` filters
    // returned nothing for teammates who didn't author the row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id,account_role')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    if (
      !isAccountRole(profile?.account_role) ||
      !canSendMessages(profile.account_role)
    ) {
      return NextResponse.json(
        { error: 'Sending requires an agent role', outcome: 'rejected' },
        { status: 403 }
      );
    }
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const {
      // `conversation_id` targets an existing thread (inbox). `contact_id`
      // lets a caller initiate from a contact that may have no conversation
      // yet (Contact detail → Send template) — we find-or-create one below.
      conversation_id: conversationIdInput,
      contact_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
      operation_id,
    } = body;
    if (
      operation_id !== undefined &&
      (!isOperationId(operation_id) || !conversationIdInput)
    ) {
      return NextResponse.json(
        {
          error: 'A valid operation_id requires conversation_id',
          outcome: 'rejected',
        },
        { status: 400 }
      );
    }

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        {
          error:
            'Either conversation_id or contact_id, plus message_type, are required',
        },
        { status: 400 }
      );
    }

    // Validate the message shape up front — before the contact_id path
    // finds-or-creates a conversation — so an invalid payload 400s
    // without leaving an orphan empty conversation behind.
    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        );
      }
      throw err;
    }

    // Resolve the target conversation. With `conversation_id` we load the
    // existing thread; with `contact_id` we find-or-create one for the
    // contact so a business-initiated template send (Contact detail view)
    // reuses the shared send core below.
    let conversationId: string | null = null;

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single();

      if (convError || !data) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
      conversationId = data.id;
    } else {
      // contact_id path: verify the contact is in this account first so a
      // caller can't open a conversation against someone else's contact.
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        );
      }

      const resolved = await findOrCreateConversation(
        supabase,
        accountId,
        user.id,
        contact_id
      );
      if (!resolved) {
        return NextResponse.json(
          { error: 'Failed to open a conversation for this contact' },
          { status: 500 }
        );
      }
      conversationId = resolved;
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    let ledger: ReturnType<typeof supabaseAdmin> | null = null;
    if (operation_id) {
      try {
        ledger = supabaseAdmin();
        const claim = await claimSendOperation(ledger, {
          id: operation_id,
          account_id: accountId,
          user_id: user.id,
          conversation_id: conversationId,
          request_hash: sendFingerprint({
            conversationId,
            message_type,
            content_text,
            media_url,
            filename,
            template_name,
            template_language,
            template_params,
            template_message_params,
            interactive_payload,
            reply_to_message_id,
          }),
        });
        if (!claim.claimed) {
          if (claim.conflict)
            return NextResponse.json(
              {
                error: 'Operation conflicts with an existing request',
                outcome: 'rejected',
                code: 'operation_conflict',
              },
              { status: 409 }
            );
          return NextResponse.json(operationResponse(claim.operation), {
            status: claim.operation.state === 'rejected' ? 422 : 200,
          });
        }
      } catch {
        // No provider call occurred. Fail closed if the migration/ledger is missing.
        return NextResponse.json(
          {
            error: 'Send recovery is temporarily unavailable',
            outcome: 'rejected',
            code: 'ledger_unavailable',
          },
          { status: 503 }
        );
      }
    }

    // Delegate to the shared send core (validates, sends to Meta with
    // phone-variant retry, persists, pauses active flow runs). Its
    // `SendMessageError` carries a machine code + HTTP status; the
    // dashboard maps it to the internal `{ error }` shape.
    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        templateName: template_name,
        templateLanguage: template_language,
        templateParams: template_params,
        templateMessageParams: template_message_params,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
        onProviderAccepted:
          ledger && operation_id
            ? async (providerId) => {
                await settleSendOperation(ledger!, operation_id, {
                  state: 'accepted',
                  whatsapp_message_id: providerId,
                });
              }
            : undefined,
      });
      if (ledger && operation_id) {
        await settleSendOperation(ledger, operation_id, {
          state: 'sent',
          message_id: result.messageId,
          whatsapp_message_id: result.whatsappMessageId,
        });
      }

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
      });
    } catch (err) {
      const outcome = err instanceof SendMessageError ? err.outcome : 'unknown';
      const code = err instanceof SendMessageError ? err.code : 'send_unknown';
      if (ledger && operation_id) {
        try {
          await settleSendOperation(ledger, operation_id, {
            state: outcome === 'rejected' ? 'rejected' : 'unknown',
            error_code: code,
          });
        } catch {
          /* The persisted claim still prevents a duplicate send. */
        }
      }
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message, outcome, code, operation_id },
          { status: err.status }
        );
      }
      return NextResponse.json(
        {
          error: 'Delivery could not be confirmed',
          outcome: 'unknown',
          operation_id,
        },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

/** Reconciliation is read-only and uses caller RLS, including current assignment. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('operation_id');
  if (!isOperationId(id))
    return NextResponse.json(
      { error: 'Invalid operation ID' },
      { status: 400 }
    );
  try {
    const db = await createClient();
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data, error } = await db
      .from('outbound_send_operations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Recovery unavailable' },
        { status: 503 }
      );
    if (!data)
      return NextResponse.json(
        { outcome: 'unknown', code: 'not_found' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    return NextResponse.json(operationResponse(data as SendOperation), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Recovery unavailable' },
      { status: 503 }
    );
  }
}

type SendSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a single
 * thread per contact. Runs under the caller's RLS — the conversations_insert
 * policy requires account agent membership, which the caller already is.
 */
async function findOrCreateConversation(
  supabase: SendSupabase,
  accountId: string,
  userId: string,
  contactId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select('id')
    .single();

  if (error) {
    console.error(
      'Error creating conversation for contact send:',
      error.message
    );
    return null;
  }

  return created.id;
}
