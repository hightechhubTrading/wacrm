// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
//
// The ONE place the two callers diverge is `SendMessageOptions.publicApi`:
// the public endpoint is forbidden from sending through an agent's
// personal WAHA number. See the rejection in the WAHA branch below.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  describeFetchError,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { resolveAgentWahaChannel } from '@/lib/whatsapp/resolve-agent-channel';
import { sendWahaIndividualText, WahaSendError } from '@/lib/notifications/waha-client';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageOptions {
  /**
   * Set by the public, API-key-authenticated `/api/v1/messages` route.
   * Makes a WAHA-routed conversation a hard rejection instead of a
   * silent send through the assigned agent's personal WhatsApp account.
   * Omitted (falsy) for the dashboard, where a human agent sending from
   * their own number is the entire point of the feature.
   */
  publicApi?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

/**
 * Validate that `replyToMessageId` (if provided) belongs to this
 * conversation — otherwise a caller could quote a message from a
 * conversation they don't have access to by guessing a UUID. Resolves
 * to the parent's Meta `message_id` (wamid), for the Meta path's reply
 * context; `undefined` if no reply was requested, or the parent has no
 * wamid (e.g. it was itself sent via WAHA). Throws `SendMessageError`
 * on a real mismatch/miss. Shared by both the Meta and WAHA send paths
 * so the membership check can't be skipped by either.
 */
async function resolveReplyTarget(
  db: SupabaseClient,
  conversationId: string,
  replyToMessageId: string | null | undefined
): Promise<string | undefined> {
  if (!replyToMessageId) return undefined;

  const { data: parent, error: parentError } = await db
    .from('messages')
    .select('message_id, conversation_id')
    .eq('id', replyToMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (parentError || !parent) {
    throw new SendMessageError(
      'bad_request',
      'reply_to_message_id not found in this conversation',
      400
    );
  }
  if (!parent.message_id) {
    console.warn(
      '[send-message] reply target has no Meta message_id; sending without context'
    );
    return undefined;
  }
  return parent.message_id;
}

/**
 * Pause any active Flow run for this contact — the agent stepping in
 * (via any channel) is the strongest "yield, human is here" signal.
 * Best-effort: must never fail the send itself.
 */
async function pauseFlowRunForContact(
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Pause the AI auto-reply bot for this conversation — an agent
 * manually sending a message (via any channel) is a strong "human is
 * here" signal, the same as the explicit "Take over" toggle, so the
 * bot must not talk over them on the next inbound. Sticky until an
 * agent re-enables it (mirrors ai_autoreply_disabled semantics in
 * auto-reply.ts). Best-effort: must never fail the send itself.
 */
async function pauseAiAutoReplyForConversation(
  accountId: string,
  conversationId: string
): Promise<void> {
  try {
    const { error: aiPauseErr } = await supabaseAdmin()
      .from('conversations')
      .update({ ai_autoreply_disabled: true })
      .eq('id', conversationId)
      .eq('account_id', accountId);
    if (aiPauseErr) {
      console.error('[ai] pause-on-agent-send failed:', aiPauseErr.message);
    }
  } catch (err) {
    console.error(
      '[ai] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams,
  options: SendMessageOptions = {}
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // If the conversation's assigned agent has their own connected WAHA
  // channel, route through it instead of the account's shared Meta
  // number — see resolve-agent-channel.ts for the resolution rule.
  // This ships text-only: any other message type routed to WAHA is a
  // hard error rather than a silent Meta fallback (which would send
  // from the wrong number without the agent realizing it) or an
  // unverified media call.
  const wahaChannel = await resolveAgentWahaChannel(
    db,
    accountId,
    conversation.assigned_agent_id ?? null
  );

  if (wahaChannel) {
    // Automated traffic must never leave an agent's personal WhatsApp
    // account. It's a real, human-registered number with no Business
    // API protections — bulk/automated sending from one is precisely
    // the pattern WhatsApp bans numbers for, and the agent would lose
    // their own account, not a company asset. The feature spec's first
    // non-goal is "no automation on WAHA-routed conversations", and the
    // WAHA inbound webhook enforces the same rule structurally by never
    // importing the flow / automation / AI dispatchers.
    //
    // The dashboard path is unaffected: a human agent clicking Send in
    // the inbox is the whole point. Only the API-key-authenticated
    // `/api/v1/messages` endpoint passes `publicApi: true`, and it fails
    // loudly here rather than silently falling back to Meta — an
    // integration that thinks it's messaging a customer should be told
    // its target is human-owned, not quietly re-routed to a different
    // sending identity.
    if (options.publicApi) {
      throw new SendMessageError(
        'waha_public_api_forbidden',
        `This conversation is routed through ${wahaChannel.agentPhone}'s personal WhatsApp number, which the public API is not allowed to send from (automated traffic on a personal number risks a WhatsApp ban). Unassign the conversation, or clear that agent's WAHA session, to send it over the account's Business number.`,
        403
      );
    }

    if (messageType !== 'text') {
      throw new SendMessageError(
        'waha_unsupported_type',
        `This conversation is routed through ${wahaChannel.agentPhone}'s WhatsApp number, which only supports plain text messages (no ${messageType}).`,
        400
      );
    }

    // Same conversation-membership check as the Meta path. WAHA sends
    // don't thread reply context into the outbound API call, but the
    // `reply_to_message_id` persisted on the new row still needs the
    // same guard against quoting a message from a conversation the
    // caller can't see.
    await resolveReplyTarget(db, conversationId, replyToMessageId);

    try {
      await sendWahaIndividualText({
        baseUrl: wahaChannel.baseUrl,
        apiKey: wahaChannel.apiKey,
        session: wahaChannel.session,
        toPhone: sanitizedPhone,
        text: contentText!,
      });
    } catch (err) {
      if (err instanceof WahaSendError) {
        throw new SendMessageError(
          'waha_error',
          `Failed to send from ${wahaChannel.agentPhone}'s WhatsApp — reconnect the agent's session in Settings → Members, or reassign the conversation. (${err.message})`,
          502
        );
      }
      throw err;
    }

    const waMessageId = '';
    const { data: messageRecord, error: msgError } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: contentText,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
        channel: 'waha',
      })
      .select()
      .single();

    if (msgError) {
      throw new SendMessageError(
        'db_error',
        `Message sent via WAHA but failed to save to DB: ${msgError.message}`,
        500
      );
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    // Pause any active Flow run and the AI auto-reply bot — an agent
    // manually replying is exactly as strong a "human is here" signal
    // over WAHA as it is over Meta. Best-effort.
    await pauseFlowRunForContact(accountId, contact.id);
    await pauseAiAutoReplyForConversation(accountId, conversationId);

    return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
  }

  // WhatsApp config, account-scoped.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  const contextMessageId = await resolveReplyTarget(
    db,
    conversationId,
    replyToMessageId
  );

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message = describeFetchError(err);
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  const interactiveBody =
    messageType === 'interactive' ? interactivePayload!.body : null;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: interactiveBody ?? contentText ?? null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      interactive_payload:
        messageType === 'interactive' ? interactivePayload : null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
      channel: 'meta',
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : contentText || `[${messageType}]`;

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run and the AI auto-reply bot for this
  // contact/conversation — the agent stepping in is the strongest
  // "yield, human is here" signal. Best-effort.
  await pauseFlowRunForContact(accountId, contact.id);
  await pauseAiAutoReplyForConversation(accountId, conversationId);

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
