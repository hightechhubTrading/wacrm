import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const p = Number(new URL(request.url).searchParams.get('page'));
    const page = Number.isInteger(p) && p >= 0 && p < 1000 ? p : 0;
    const { data, error, count } = await ctx.supabase
      .from('quotation_sales_notes')
      .select(
        'quotation_id,reason,follow_up_date,quotations!inner(reference,client_name,client_company,status)',
        { count: 'exact' }
      )
      .eq('account_id', ctx.accountId)
      .not('follow_up_date', 'is', null)
      .order('follow_up_date')
      .range(page * 50, page * 50 + 49);
    if (error)
      return NextResponse.json(
        { error: 'Follow-ups unavailable. Apply migration 090.' },
        { status: 503 }
      );
    return NextResponse.json({ rows: data, count });
  } catch (e) {
    return toErrorResponse(e);
  }
}
