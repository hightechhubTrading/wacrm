import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findOrCreateContact,
  findOrCreateConversation,
} from '@/lib/contacts/find-or-create';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import type { CallWebhookValue } from './types';

function unix(value: string | undefined): string | null {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0
    ? new Date(n * 1000).toISOString()
    : null;
}

export async function recordCallPermissionReply(
  db: SupabaseClient,
  value: {
    conversationId: string;
    accountId: string;
    unreadCount: number;
    messageId: string;
    accepted: boolean;
  }
) {
  const text = value.accepted
    ? 'WhatsApp call permission granted'
    : 'WhatsApp call permission declined or revoked';
  const { error } = await db.from('messages').insert({
    conversation_id: value.conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: text,
    message_id: value.messageId,
    status: 'delivered',
  });
  if (error) throw new Error('Could not save call permission reply');
  const { error: updateError } = await db
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      unread_count: value.unreadCount + 1,
    })
    .eq('id', value.conversationId)
    .eq('account_id', value.accountId);
  if (updateError)
    throw new Error('Could not update call permission conversation');
}
export function normalizeCallEvent(
  call: NonNullable<CallWebhookValue['calls']>[number]
) {
  const outbound =
    call.direction === 'BUSINESS_INITIATED' ||
    call.session?.sdp_type === 'answer';
  const terminal = call.event === 'terminate';
  const failed = String(call.status).toUpperCase() === 'FAILED';
  return {
    meta_call_id: call.id,
    local_id: /^[0-9a-f-]{36}$/i.test(call.biz_opaque_callback_data || '')
      ? call.biz_opaque_callback_data
      : null,
    event: call.event,
    direction: outbound ? 'outbound' : 'inbound',
    state: terminal
      ? failed
        ? 'failed'
        : call.start_time
          ? 'completed'
          : outbound
            ? 'completed'
            : 'missed'
      : outbound
        ? 'connecting'
        : 'ringing',
    created_at: unix(call.timestamp),
    answered_at: unix(call.start_time),
    ended_at: terminal
      ? unix(call.end_time) || unix(call.timestamp) || new Date().toISOString()
      : null,
    duration_seconds:
      typeof call.duration === 'number' && call.duration >= 0
        ? Math.floor(call.duration)
        : null,
    remote_sdp: call.session?.sdp,
    remote_sdp_type: call.session?.sdp_type,
  };
}
export async function handleCallWebhook(
  value: CallWebhookValue,
  db: SupabaseClient
) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('account_id, user_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (error || !config) throw new Error('Cannot resolve calling account');

  for (const call of value.calls || []) {
    if (!call.id || !['connect', 'terminate'].includes(call.event)) continue;
    const normalized = normalizeCallEvent(call);
    // Prefer the direction-aware participant, then match the contact by wa_id.
    const participant =
      normalized.direction === 'outbound' ? call.to : call.from;
    const contact =
      value.contacts?.find((c) => c.wa_id === participant) ||
      value.contacts?.[0];
    const phone = sanitizePhoneForMeta(participant || contact?.wa_id || '');
    let conversationId: string | null = null;
    if (isValidE164(phone)) {
      const resolved = await findOrCreateContact(
        db,
        config.account_id,
        config.user_id,
        phone,
        contact?.profile?.name || phone
      );
      if (!resolved) throw new Error('Cannot resolve caller');
      const conversation = await findOrCreateConversation(
        db,
        config.account_id,
        config.user_id,
        resolved.contact.id
      );
      if (!conversation) throw new Error('Cannot resolve call conversation');
      conversationId = conversation.conversation.id;
    }
    const { error: ingestError } = await db.rpc('ingest_whatsapp_call', {
      p_account_id: config.account_id,
      p_event: {
        ...normalized,
        phone_number_id: phoneNumberId,
        conversation_id: conversationId,
        customer_phone: isValidE164(phone) ? phone : null,
        customer_name: contact?.profile?.name || null,
        error_message:
          value.errors?.[0]?.error_data?.details ||
          value.errors?.[0]?.message ||
          null,
      },
    });
    if (ingestError)
      throw new Error(`Call event persistence failed: ${ingestError.message}`);
  }
  for (const status of value.statuses || []) {
    if (
      !['RINGING', 'ACCEPTED', 'REJECTED'].includes(
        status.status?.toUpperCase()
      )
    )
      continue;
    const state = status.status.toUpperCase();
    const { error: statusError } = await db.rpc('ingest_whatsapp_call', {
      p_account_id: config.account_id,
      p_event: {
        meta_call_id: status.id,
        event: 'status',
        direction: 'outbound',
        state:
          state === 'ACCEPTED'
            ? 'active'
            : state === 'REJECTED'
              ? 'rejected'
              : 'connecting',
        created_at: unix(status.timestamp),
      },
    });
    if (statusError) throw new Error('Call status persistence failed');
  }
}
