import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`conversation-activity:${ctx.userId}`, {
      limit: 60,
      windowMs: 60000,
    });
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !uuid(body.conversationId) ||
      !uuid(body.tabId) ||
      !Number.isSafeInteger(body.sequence) ||
      body.sequence < 1 ||
      typeof body.composing !== 'boolean' ||
      typeof body.leave !== 'boolean'
    )
      return NextResponse.json(
        { error: 'Invalid activity request' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc(
      'record_conversation_activity',
      {
        p_conversation: body.conversationId,
        p_tab: body.tabId,
        p_sequence: body.sequence,
        p_composing: body.composing,
        p_leave: body.leave,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'Activity unavailable' },
        { status: error.code === '42501' ? 403 : 503 }
      );
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const params = new URL(request.url).searchParams;
    const conversation = params.get('conversationId'),
      tab = params.get('tabId');
    if (!uuid(conversation) || !uuid(tab))
      return NextResponse.json(
        { error: 'Invalid activity request' },
        { status: 400 }
      );
    const limit = checkRateLimit(`conversation-activity-read:${ctx.userId}`, {
      limit: 120,
      windowMs: 60000,
    });
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await ctx.supabase.rpc(
      'conversation_activity_snapshot',
      { p_conversation: conversation, p_tab: tab }
    );
    if (error)
      return NextResponse.json(
        { error: 'Activity unavailable' },
        { status: 503 }
      );
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
