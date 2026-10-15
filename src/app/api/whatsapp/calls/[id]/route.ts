import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  callingAdmin,
  callingConfig,
  readCallingBody,
  requiredString,
  requiredSdp,
} from '@/lib/whatsapp/calling/server';
import { CallingError, callAction } from '@/lib/whatsapp/calling/meta';
import { isActiveCall, type CallRecord } from '@/lib/whatsapp/calling/types';

export const maxDuration = 45;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = await readCallingBody(request);
    const action = requiredString(body, 'action');
    const clientId = requiredString(body, 'client_id');
    if (
      !['claim', 'pre_accept', 'accept', 'reject', 'terminate'].includes(action)
    )
      throw new CallingError('Invalid call action.');
    const { data } = await ctx.supabase
      .from('whatsapp_calls')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!data)
      throw new CallingError('Call not found or unavailable to you.', 404);
    const call = data as CallRecord;
    if (!isActiveCall(call.state))
      throw new CallingError('This call has ended.', 409);
    const db = callingAdmin();
    // Ending an existing call remains possible when an admin disables calling.
    const config = await callingConfig(
      ctx.accountId,
      !['reject', 'terminate'].includes(action)
    );
    if (config.phone_number_id !== call.phone_number_id)
      throw new CallingError(
        'This call belongs to a previous WhatsApp number.',
        409
      );
    if (action === 'claim' || action === 'reject') {
      if (
        call.direction !== 'inbound' ||
        call.state !== 'ringing' ||
        Date.now() - Date.parse(call.created_at) > 60_000
      ) {
        throw new CallingError('This call is no longer ringing.', 409);
      }
      const { data: claimed, error } = await db
        .from('whatsapp_calls')
        .update({
          agent_user_id: ctx.userId,
          owner_client_id: clientId,
          state: 'connecting',
        })
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .eq('state', 'ringing')
        .is('agent_user_id', null)
        .select('*')
        .maybeSingle();
      if (error || !claimed)
        throw new CallingError(
          'Another agent answered this call, or you already have an active call.',
          409
        );
      if (action === 'claim') return NextResponse.json({ call: claimed });
    } else if (
      call.agent_user_id !== ctx.userId ||
      (action !== 'terminate' && call.owner_client_id !== clientId)
    ) {
      throw new CallingError(
        'This call is controlled by another agent or browser tab.',
        409
      );
    }
    if (!call.meta_call_id)
      throw new CallingError(
        'The call is still being created. Try again.',
        409
      );
    if (
      ['pre_accept', 'accept'].includes(action) &&
      (call.direction !== 'inbound' || call.state !== 'connecting')
    ) {
      throw new CallingError(
        'The call cannot be accepted in its current state.',
        409
      );
    }
    const sdp = ['pre_accept', 'accept'].includes(action)
      ? requiredSdp(body)
      : undefined;
    try {
      await callAction(config, {
        call_id: call.meta_call_id,
        action,
        ...(sdp ? { session: { sdp_type: 'answer', sdp } } : {}),
      });
    } catch (error) {
      // Keep ownership after a failed hangup so the browser can retry; do not
      // release a call while Meta may still be carrying audio.
      if (action === 'reject') {
        await db
          .from('whatsapp_calls')
          .update({
            agent_user_id: null,
            owner_client_id: null,
            state: 'ringing',
          })
          .eq('id', id)
          .eq('state', 'connecting')
          .is('ended_at', null);
      }
      throw error;
    }
    if (action !== 'pre_accept') {
      const terminal = action === 'terminate' || action === 'reject';
      const { error } = await db
        .from('whatsapp_calls')
        .update({
          state: terminal
            ? action === 'reject'
              ? 'rejected'
              : call.answered_at
                ? 'completed'
                : call.direction === 'inbound'
                  ? 'missed'
                  : 'completed'
            : 'active',
          ...(terminal
            ? {
                ended_at: new Date().toISOString(),
                remote_sdp: null,
                duration_seconds: call.answered_at
                  ? Math.max(
                      0,
                      Math.floor(
                        (Date.now() - Date.parse(call.answered_at)) / 1000
                      )
                    )
                  : null,
              }
            : { answered_at: new Date().toISOString() }),
        })
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .is('ended_at', null);
      if (error)
        throw new CallingError(
          'Call action succeeded but its history could not be saved.',
          500
        );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
