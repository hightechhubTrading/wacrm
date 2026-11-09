import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  bookingInput,
  calendarRange,
  UUID,
  type Appointment,
} from '@/lib/jobs/appointments';
import { bookingError, jobPeople } from '@/lib/jobs/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const range = calendarRange(
      url.searchParams.get('from'),
      url.searchParams.get('to')
    );
    if (!range)
      return NextResponse.json(
        { error: 'Choose a calendar range of up to eight days.' },
        { status: 400 }
      );
    const [visible, busy, unscheduled, members] = await Promise.all([
      ctx.supabase
        .from('job_appointments')
        .select(
          '*,work:group_handoffs!inner(reference,kind,status,location,deal:deals!inner(title))'
        )
        .eq('account_id', ctx.accountId)
        .neq('status', 'cancelled')
        .lt('starts_at', range.to)
        .gt('ends_at', range.from)
        .order('starts_at')
        .limit(1001),
      // Company-wide capacity includes jobs hidden by deal-assignment RLS.
      // Only anonymous occupied intervals leave this service-role query.
      supabaseAdmin()
        .from('job_appointments')
        .select('id,starts_at,ends_at,status')
        .eq('account_id', ctx.accountId)
        .eq('status', 'reserved')
        .lt('starts_at', range.to)
        .gt('ends_at', range.from)
        .order('starts_at')
        .limit(2000),
      ctx.supabase
        .from('group_handoffs')
        .select(
          'id,deal_id,reference,kind,status,responsible_profile_id,location,due_at,deal:deals(title),appointment:job_appointments(id)'
        )
        .eq('account_id', ctx.accountId)
        .not('status', 'in', '(report_received,installed,cancelled)')
        .is('appointment', null)
        .order('created_at', { ascending: false })
        .limit(101),
      jobPeople(ctx),
    ]);
    if (
      visible.error ||
      busy.error ||
      unscheduled.error ||
      (busy.data?.length ?? 0) >= 2000
    )
      return NextResponse.json(
        { error: 'Could not verify the company calendar.' },
        { status: 503 }
      );
    const appointments = new Map<string, Appointment>();
    for (const row of busy.data ?? [])
      appointments.set(row.id, {
        id: row.id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: 'reserved',
      });
    for (const row of (visible.data ?? []).slice(0, 1000))
      appointments.set(row.id, row as unknown as Appointment);
    return NextResponse.json(
      {
        appointments: [...appointments.values()].sort((a, b) =>
          a.starts_at.localeCompare(b.starts_at)
        ),
        unscheduled: (unscheduled.data ?? []).slice(0, 100),
        hasMore:
          (unscheduled.data?.length ?? 0) > 100 ||
          (visible.data?.length ?? 0) > 1000,
        ...members,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `job-calendar:${ctx.userId}`,
      RATE_LIMITS.send
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return NextResponse.json({ error: 'Invalid booking' }, { status: 400 });
    const booking = bookingInput(body);
    if (
      !booking ||
      !UUID.test(body.dealId ?? '') ||
      !UUID.test(body.handoffId ?? '') ||
      (body.revision !== undefined &&
        (!Number.isSafeInteger(body.revision) || body.revision < 0))
    )
      return NextResponse.json(
        {
          error:
            'Choose a responsible member and valid future start/end times.',
          code: 'invalid_booking',
        },
        { status: 400 }
      );
    const { data: work, error: readError } = await ctx.supabase
      .from('group_handoffs')
      .select('id')
      .eq('id', body.handoffId)
      .eq('account_id', ctx.accountId)
      .eq('deal_id', body.dealId)
      .maybeSingle();
    if (readError) throw new Error('Booking lookup failed');
    if (!work)
      return NextResponse.json({ error: 'Job unavailable' }, { status: 404 });
    const { defaultResponsibleId } = await jobPeople(ctx);
    const { data, error } = await supabaseAdmin().rpc('save_job_appointment', {
      p_account: ctx.accountId,
      p_deal: body.dealId,
      p_handoff: work.id,
      p_actor: ctx.userId,
      p_responsible: booking.responsible_profile_id ?? defaultResponsibleId,
      p_start: booking.starts_at,
      p_end: booking.ends_at,
      p_revision: body.revision ?? null,
    });
    if (error) return bookingError(error);
    if (!data)
      return NextResponse.json(
        {
          error: 'This booking changed. Reload the calendar.',
          code: 'stale_booking',
        },
        { status: 409 }
      );
    return NextResponse.json({ id: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
