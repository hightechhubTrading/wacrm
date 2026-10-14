import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  callingConfig,
  visibleConversation,
  readCallingBody,
  requiredString,
} from '@/lib/whatsapp/calling/server';
import {
  CallingError,
  callingRequest,
  getCallPermissions,
} from '@/lib/whatsapp/calling/meta';
import { canPerformCallAction } from '@/lib/whatsapp/calling/types';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 45;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const id = new URL(request.url).searchParams.get('conversation_id');
    if (!id) throw new CallingError('conversation_id is required.');
    const conversation = await visibleConversation(ctx, id);
    const config = await callingConfig(ctx.accountId);
    const permissions = await getCallPermissions(
      config,
      sanitizePhoneForMeta(conversation.contact.phone)
    );
    return NextResponse.json(
      { permissions },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`calling:permission:${ctx.userId}`, {
      limit: 5,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);
    const body = await readCallingBody(request);
    const id = requiredString(body, 'conversation_id');
    const conversation = await visibleConversation(ctx, id);
    if (conversation.contact.opted_out)
      throw new CallingError('This customer has opted out.', 409);
    // This entry point sends free-form permission requests only. Outside the
    // service window an approved call-permission template must be used.
    const { data: latest, error } = await ctx.supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      error ||
      !latest ||
      Date.now() - Date.parse(latest.created_at) >= 24 * 60 * 60 * 1000
    ) {
      throw new CallingError(
        'Ask the customer to message you first. A permission request requires an open 24-hour messaging window.',
        409
      );
    }
    const config = await callingConfig(ctx.accountId);
    const phone = sanitizePhoneForMeta(conversation.contact.phone);
    const permissions = await getCallPermissions(config, phone);
    if (!canPerformCallAction(permissions, 'send_call_permission_request'))
      throw new CallingError(
        'Meta does not allow another permission request yet.',
        409
      );
    const text =
      body.locale === 'ar'
        ? 'هل تسمح لنا بالاتصال بك عبر واتساب لمساعدتك في طلبك؟'
        : 'May we call you on WhatsApp to help with your enquiry?';
    const result = await callingRequest<{ messages?: Array<{ id: string }> }>(
      config,
      'messages',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'call_permission_request',
          action: { name: 'call_permission_request' },
          body: { text },
        },
      }
    );
    if (!result.messages?.[0]?.id)
      throw new CallingError(
        'Meta did not return a permission message ID.',
        502
      );
    const { error: saveError } = await ctx.supabase.from('messages').insert({
      conversation_id: id,
      sender_type: 'agent',
      content_type: 'text',
      content_text: text,
      message_id: result.messages[0].id,
      status: 'sent',
    });
    if (saveError)
      throw new CallingError(
        'Permission request sent, but could not be saved in the conversation.',
        500
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
