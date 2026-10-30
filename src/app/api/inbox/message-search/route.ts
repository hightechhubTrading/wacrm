import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return (
    year >= 1 &&
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day
  );
};
const bad = () =>
  NextResponse.json({ error: 'Invalid search parameters' }, { status: 400 });
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const limit = checkRateLimit(`message-search:${ctx.userId}`, {
      limit: 60,
      windowMs: 60000,
    });
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad();
    if (body.action === 'context') {
      if (!uuid(body.conversationId) || !uuid(body.messageId)) return bad();
      const { data, error } = await ctx.supabase.rpc('inbox_message_context', {
        p_account: ctx.accountId,
        p_conversation: body.conversationId,
        p_message: body.messageId,
      });
      if (error)
        return NextResponse.json(
          { error: 'Message context unavailable' },
          { status: 503 }
        );
      if (!data?.found)
        return NextResponse.json(
          { error: 'Message unavailable' },
          { status: 404 }
        );
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (
      typeof body.query !== 'string' ||
      body.query.trim().length < 2 ||
      body.query.length > 200
    )
      return bad();
    if (body.conversationId != null && !uuid(body.conversationId)) return bad();
    if (
      body.sender != null &&
      !['customer', 'agent', 'bot'].includes(body.sender)
    )
      return bad();
    if (
      (body.from != null && !timestamp(body.from)) ||
      (body.to != null && !timestamp(body.to))
    )
      return bad();
    if (body.from && body.to && Date.parse(body.from) >= Date.parse(body.to))
      return bad();
    if (
      body.cursor != null &&
      (!uuid(body.cursor.id) || !timestamp(body.cursor.created_at))
    )
      return bad();
    const { data, error } = await ctx.supabase.rpc('search_inbox_messages', {
      p_account: ctx.accountId,
      p_query: body.query.trim(),
      p_conversation: body.conversationId ?? null,
      p_sender: body.sender ?? null,
      p_from: body.from ?? null,
      p_to: body.to ?? null,
      p_cursor: body.cursor ?? null,
      p_limit: 25,
    });
    if (error)
      return NextResponse.json(
        { error: 'Message search unavailable' },
        { status: 503 }
      );
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
