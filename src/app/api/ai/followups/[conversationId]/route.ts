import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  FOLLOWUP_KINDS,
  ensureFollowup,
  followupPatch,
  type FollowupKind,
} from '@/lib/ai/followups';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
type Params = { params: Promise<{ conversationId: string }> };
async function context(params: Params['params']) {
  const ctx = await requireRole('agent');
  const { conversationId } = await params;
  const { data, error } = await ctx.supabase
    .from('conversations')
    .select('id,assigned_agent_id,ai_autoreply_disabled')
    .eq('id', conversationId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) throw new Error('Conversation lookup failed');
  return { ...ctx, conversationId, conversation: data };
}
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await context(params);
    if (!ctx.conversation)
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    const [work, events] = await Promise.all([
      ctx.supabase
        .from('ai_followups')
        .select('*')
        .eq('conversation_id', ctx.conversationId)
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(30),
      ctx.supabase
        .from('ai_reply_events')
        .select('outcome,reason,created_at')
        .eq('conversation_id', ctx.conversationId)
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    return NextResponse.json({
      available: !work.error && !events.error,
      followups: work.data ?? [],
      latestEvent: events.data?.[0] ?? null,
      conversation: ctx.conversation,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await context(params);
    if (!ctx.conversation)
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    const limit = checkRateLimit(`ai-followup:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const b = await request.json().catch(() => null);
    if (!b || !FOLLOWUP_KINDS.includes(b.kind))
      return NextResponse.json(
        { error: 'Invalid follow-up type' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase
      .from('messages')
      .select('message_id')
      .eq('conversation_id', ctx.conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('Source lookup failed');
    const id = await ensureFollowup(supabaseAdmin(), {
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      sourceMessageId: data?.message_id ?? undefined,
      kind: b.kind as FollowupKind,
      ownerId: ctx.userId,
    });
    return id
      ? NextResponse.json({ id })
      : NextResponse.json(
          { error: 'Follow-up storage unavailable' },
          { status: 503 }
        );
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await context(params);
    if (!ctx.conversation)
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    const limit = checkRateLimit(`ai-followup:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const b = await request.json().catch(() => null);
    const patch = followupPatch(b, ctx.userId);
    if (!patch || typeof b?.id !== 'string')
      return NextResponse.json(
        { error: 'Invalid status, date or completion evidence' },
        { status: 400 }
      );
    // A service write only after the RLS conversation gate; never accept a tenant/owner from the body.
    const { data, error } = await supabaseAdmin()
      .from('ai_followups')
      .update(patch)
      .eq('id', b.id)
      .eq('conversation_id', ctx.conversationId)
      .eq('account_id', ctx.accountId)
      .in('status', ['open', 'acknowledged', 'deferred'])
      .select('id')
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Could not update follow-up' },
        { status: 503 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Follow-up not found or already closed' },
        { status: 409 }
      );
    return NextResponse.json({ success: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
