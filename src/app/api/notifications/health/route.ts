import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { activePushConfig } from '@/lib/mobile/push/config';
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const db = supabaseAdmin();
    const [queue, failed, oldest, worker, push, policy, configured] =
      await Promise.all([
        db
          .from('notification_events')
          .select('id', { head: true, count: 'exact' })
          .eq('account_id', ctx.accountId)
          .is('delivered_at', null)
          .lt('attempts', 10),
        db
          .from('notification_events')
          .select('id', { head: true, count: 'exact' })
          .eq('account_id', ctx.accountId)
          .is('delivered_at', null)
          .gte('attempts', 10),
        db
          .from('notification_events')
          .select('created_at')
          .eq('account_id', ctx.accountId)
          .is('delivered_at', null)
          .order('created_at')
          .limit(1),
        db
          .from('notification_worker_health')
          .select('last_success_at,processed')
          .eq('id', true)
          .maybeSingle(),
        db
          .from('mobile_push_jobs')
          .select('id', { head: true, count: 'exact' })
          .eq('account_id', ctx.accountId)
          .in('state', ['pending', 'leased']),
        db
          .from('notification_account_policy')
          .select('escalation_enabled,escalation_minutes,timezone')
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        activePushConfig(),
      ]);
    if ([queue, failed, oldest, worker, push, policy].some((x) => x.error))
      return NextResponse.json(
        { error: 'Notification health unavailable' },
        { status: 503 }
      );
    const heartbeat = worker.data?.last_success_at ?? null;
    return NextResponse.json(
      {
        pending: queue.count ?? 0,
        failed: failed.count ?? 0,
        oldestPendingAt: oldest.data?.[0]?.created_at ?? null,
        lastSuccessAt: heartbeat,
        workerHealthy:
          !!heartbeat && Date.now() - Date.parse(heartbeat) < 180000,
        pushPending: push.count ?? 0,
        pushConfigured: !!configured,
        policy: policy.data ?? {
          escalation_enabled: false,
          escalation_minutes: 15,
          timezone: 'Asia/Qatar',
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const b = await request.json().catch(() => null);
    if (
      !b ||
      typeof b.enabled !== 'boolean' ||
      !Number.isInteger(b.minutes) ||
      b.minutes < 5 ||
      b.minutes > 1440
    )
      return NextResponse.json(
        { error: 'Choose an escalation delay from 5 to 1440 minutes' },
        { status: 400 }
      );
    const { error } = await ctx.supabase
      .from('notification_account_policy')
      .upsert(
        {
          account_id: ctx.accountId,
          escalation_enabled: b.enabled,
          escalation_minutes: b.minutes,
        },
        { onConflict: 'account_id' }
      );
    if (error)
      return NextResponse.json(
        { error: 'Could not save escalation policy' },
        { status: 503 }
      );
    return NextResponse.json({ success: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const { data, error } = await ctx.supabase.rpc(
      'retry_notification_events',
      { p_account: ctx.accountId }
    );
    if (error)
      return NextResponse.json(
        { error: 'Could not retry failed notices' },
        { status: 503 }
      );
    return NextResponse.json({ retried: data });
  } catch (e) {
    return toErrorResponse(e);
  }
}
