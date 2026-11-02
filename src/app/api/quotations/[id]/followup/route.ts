import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data: q } = await ctx.supabase
      .from('quotations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!q)
      return NextResponse.json(
        { error: 'Quotation not found.' },
        { status: 404 }
      );
    const { data, error } = await ctx.supabase
      .from('quotation_sales_notes')
      .select('*')
      .eq('quotation_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Sales notes unavailable. Apply migration 090.' },
        { status: 503 }
      );
    return NextResponse.json(
      data ?? { reason: '', follow_up_date: null, version: 0 }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const b = await request.json().catch(() => null);
    const date = b?.followUpDate;
    if (
      !b ||
      typeof b.reason !== 'string' ||
      b.reason.length > 2000 ||
      !Number.isInteger(b.version) ||
      b.version < 0 ||
      (date !== null &&
        (typeof date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date))
    )
      return NextResponse.json(
        { error: 'Invalid sales notes.' },
        { status: 400 }
      );
    const { error } = await ctx.supabase.rpc('save_quotation_sales_notes', {
      p_quotation_id: id,
      p_version: b.version,
      p_reason: b.reason,
      p_follow_up_date: date,
    });
    if (error)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === '40001' ? 409 : 400 }
      );
    return NextResponse.json({ ok: true, version: b.version + 1 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
