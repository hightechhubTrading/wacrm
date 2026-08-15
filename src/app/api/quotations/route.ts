import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createQuotation } from '@/lib/quotations/crud';
import { mapQuotationRow } from '@/lib/quotations/types';

/**
 * POST /api/quotations
 *
 * accountId always comes from the authenticated caller's own
 * membership (`ctx.accountId`), never from the request body -- the
 * body is untrusted input, and trusting an accountId there would let
 * any agent create quotations under a different tenant's account.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();
    if (!body.productCode) {
      return NextResponse.json({ error: 'productCode is required' }, { status: 400 });
    }
    const quotation = await createQuotation({ ...body, accountId: ctx.accountId });
    return NextResponse.json(quotation, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * GET /api/quotations
 *
 * List, optionally filtered by `status`. Same authorization shape as
 * POST above: accountId always comes from `ctx.accountId` (the caller's
 * own membership), never from the query string -- and the query runs
 * through `ctx.supabase`, not the service-role client, so
 * quotations_select RLS (059) is still the backstop even if this
 * filter were ever wrong.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = ctx.supabase
      .from('quotations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json((data ?? []).map(mapQuotationRow));
  } catch (err) {
    return toErrorResponse(err);
  }
}
