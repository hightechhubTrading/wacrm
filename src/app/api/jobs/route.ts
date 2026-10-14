import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const { data, error } = await ctx.supabase
      .from('group_handoffs')
      .select(
        'id,deal_id,reference,kind,status,due_at,responsible,updated_at,deal:deals(title)'
      )
      .eq('account_id', ctx.accountId)
      .not('status', 'in', '(report_received,installed,cancelled)')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: true })
      .limit(101);
    if (error)
      return NextResponse.json(
        { error: 'Could not load waiting work' },
        { status: 503 }
      );
    return NextResponse.json({
      work: (data ?? []).slice(0, 100),
      hasMore: (data?.length ?? 0) > 100,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
