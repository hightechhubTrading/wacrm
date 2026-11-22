import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const [preferences, mobile] = await Promise.all([
      ctx.supabase
        .from('notification_preferences')
        .select(
          'foreground_enabled,sound_enabled,supervise_messages,push_categories'
        )
        .eq('account_id', ctx.accountId)
        .eq('user_id', ctx.userId)
        .maybeSingle(),
      supabaseAdmin()
        .from('mobile_push_preferences')
        .select('quiet_start,quiet_end,timezone')
        .eq('account_id', ctx.accountId)
        .eq('user_id', ctx.userId)
        .maybeSingle(),
    ]);
    if (preferences.error || mobile.error)
      return NextResponse.json(
        { error: 'Notification settings unavailable' },
        { status: 503 }
      );
    return NextResponse.json(
      {
        categories: preferences.data?.push_categories ?? [
          'assignments',
          'attention',
          'followups',
          'system',
          'jobs',
        ],
        foreground: preferences.data?.foreground_enabled ?? true,
        sound: preferences.data?.sound_enabled ?? false,
        supervise: preferences.data?.supervise_messages ?? false,
        quiet: mobile.data ?? null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (
      !body ||
      ['foreground', 'sound', 'supervise'].some(
        (k) => typeof body[k] !== 'boolean'
      )
    )
      return NextResponse.json(
        { error: 'Invalid notification preferences' },
        { status: 400 }
      );
    let quietArgs = {};
    if (body.quiet !== undefined) {
      const q = body.quiet;
      if (
        !q ||
        typeof q.timezone !== 'string' ||
        (q.start === null) !== (q.end === null) ||
        [q.start, q.end].some(
          (v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 1439)
        )
      )
        return NextResponse.json(
          { error: 'Invalid quiet hours' },
          { status: 400 }
        );
      try {
        new Intl.DateTimeFormat('en', { timeZone: q.timezone }).format();
      } catch {
        return NextResponse.json(
          { error: 'Invalid timezone' },
          { status: 400 }
        );
      }
      quietArgs = { p_start: q.start, p_end: q.end, p_timezone: q.timezone };
    }
    const { error } = await ctx.supabase.rpc(
      body.quiet === undefined
        ? 'set_notification_channels'
        : 'set_notification_channel_policy',
      {
        p_account: ctx.accountId,
        p_foreground: body.foreground,
        p_sound: body.sound,
        p_supervise: body.supervise,
        ...quietArgs,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'Could not save notification preferences' },
        { status: 503 }
      );
    return NextResponse.json({ success: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
