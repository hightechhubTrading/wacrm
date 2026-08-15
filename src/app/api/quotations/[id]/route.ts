import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { saveQuotationItems } from '@/lib/quotations/crud';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';

type Params = { params: Promise<{ id: string }> };

// Shared by GET and PATCH — both return the same shape. Keeping the
// nested-items mapping in one place means a future field added to
// QuotationItem only needs mapQuotationItemRow updated, not every caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuotationWithItems(row: Record<string, any>) {
  const { quotation_items, ...quotationRow } = row;
  return {
    ...mapQuotationRow(quotationRow),
    items: (quotation_items ?? []).map(mapQuotationItemRow),
  };
}

/**
 * GET /api/quotations/[id]
 *
 * ctx.supabase is RLS-scoped to the caller — quotations_select (059)
 * already restricts rows to account members / the assigned agent, so
 * a caller without visibility gets zero rows here, not an error. That
 * is deliberately reported as 404, not 403: it doesn't leak whether
 * the id exists at all outside the caller's own scope.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    return NextResponse.json(mapQuotationWithItems(data));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/quotations/[id]
 *
 * Visibility/authorization check BEFORE any write: same RLS-backed
 * reasoning as GET above. save_quotation_items() (Task 5) runs via
 * the service-role client and no longer checks the caller's role
 * itself (see Task 5's revision note) — this is the one place that
 * check now happens, so it must run first.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: existing, error: existingErr } = await ctx.supabase
      .from('quotations')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 400 });
    if (!existing) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    const body = await request.json();

    if (body.items) {
      await saveQuotationItems(id, ctx.accountId, body.items, body.orderDiscount);
    }

    if (body.fields) {
      // Goes through ctx.supabase (not the admin client) so
      // quotations_update RLS still gates which fields an agent
      // (vs. admin) may touch on a quotation they don't own.
      const { error } = await ctx.supabase.from('quotations').update(body.fields).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data } = await ctx.supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .single();
    return NextResponse.json(mapQuotationWithItems(data));
  } catch (err) {
    return toErrorResponse(err);
  }
}
