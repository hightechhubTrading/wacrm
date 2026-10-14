import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import {
  callingAdmin,
  callingConfig,
  visibleConversation,
  readCallingBody,
  requiredString,
  requiredSdp,
} from '@/lib/whatsapp/calling/server';
import { CallingError, callAction } from '@/lib/whatsapp/calling/meta';
import { getCallPermissions } from '@/lib/whatsapp/calling/meta';
import { canPerformCallAction } from '@/lib/whatsapp/calling/types';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const conversationId = new URL(request.url).searchParams.get(
      'conversation_id'
    );
    let query = ctx.supabase
      .from('whatsapp_calls')
      .select('*')
      .eq('account_id', ctx.accountId);
    if (conversationId) {
      await visibleConversation(ctx, conversationId);
      query = query.eq('conversation_id', conversationId);
    } else {
      // Include the caller's current session even if it exceeds the ringing
      // timeout. Inbound offers older than a minute are no longer answerable.
      query = query
        .in('state', ['ringing', 'connecting', 'active'])
        .or(
          `created_at.gte.${new Date(Date.now() - 65_000).toISOString()},agent_user_id.eq.${ctx.userId}`
        );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(50);
    if (error)
      throw new CallingError(
        'Calling setup is incomplete. Ask an administrator to finish activation.',
        503
      );
    return NextResponse.json(
      { calls: data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`calling:start:${ctx.userId}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);
    const body = await readCallingBody(request);
    const conversationId = requiredString(body, 'conversation_id');
    const clientId = requiredString(body, 'client_id');
    const sdp = requiredSdp(body);
    const conversation = await visibleConversation(ctx, conversationId);
    if (conversation.contact.opted_out)
      throw new CallingError('This customer has opted out.', 409);
    const phone = sanitizePhoneForMeta(conversation.contact.phone);
    if (!isValidE164(phone))
      throw new CallingError('A valid customer phone number is required.');
    const config = await callingConfig(ctx.accountId);
    const permissions = await getCallPermissions(config, phone);
    if (!canPerformCallAction(permissions, 'start_call'))
      throw new CallingError(
        'Customer call permission is missing, expired, or a calling limit applies.',
        409
      );
    const db = callingAdmin();
    const id = crypto.randomUUID();
    const { error: insertError } = await db.from('whatsapp_calls').insert({
      id,
      account_id: ctx.accountId,
      conversation_id: conversationId,
      phone_number_id: config.phone_number_id,
      customer_phone: phone,
      customer_name: conversation.contact.name,
      direction: 'outbound',
      state: 'connecting',
      agent_user_id: ctx.userId,
      owner_client_id: clientId,
    });
    if (insertError)
      throw new CallingError(
        'You already have a call in progress, or the call could not be saved.',
        409
      );
    let metaId: string | undefined;
    try {
      const result = await callAction(config, {
        action: 'connect',
        to: phone,
        biz_opaque_callback_data: id,
        session: { sdp_type: 'offer', sdp },
      });
      metaId = result.calls?.[0]?.id;
      if (!metaId)
        throw new CallingError('Meta did not return a call ID.', 502);
      // A webhook can already have attached the ID and SDP. Do not overwrite
      // its state, SDP or completion with the HTTP response.
      const { error: linkError } = await db
        .from('whatsapp_calls')
        .update({ meta_call_id: metaId })
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (linkError)
        throw new CallingError('Call started but could not be linked.', 500);
      const { data: call, error: readError } = await db
        .from('whatsapp_calls')
        .select('*')
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .single();
      if (readError)
        throw new CallingError('Call started but could not be loaded.', 500);
      return NextResponse.json({ call });
    } catch (error) {
      if (metaId)
        await callAction(config, {
          action: 'terminate',
          call_id: metaId,
        }).catch(() => {});
      await db
        .from('whatsapp_calls')
        .update({
          state: 'failed',
          ended_at: new Date().toISOString(),
          error_message: 'Could not start call',
        })
        .eq('id', id)
        .is('ended_at', null);
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
