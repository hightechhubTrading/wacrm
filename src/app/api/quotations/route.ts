import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createQuotation, type CreateQuotationInput } from '@/lib/quotations/crud';
import { mapQuotationRow } from '@/lib/quotations/types';

// Explicit allow-list of what a caller may set on create. Everything
// else in the body is ignored -- in particular, there is no legitimate
// reason for a caller to set subtotal/total/discount_amount/etc. at
// creation time (those are always computed server-side, via
// computeQuotationTotals inside saveQuotationItems), and accountId is
// never trusted from the body regardless (see below).
const CREATE_QUOTATION_FIELDS = ['contactId', 'dealId', 'assignedTo', 'productCode', 'currency'] as const;

function pickCreateFields(body: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of CREATE_QUOTATION_FIELDS) {
    if (body[key] !== undefined) picked[key] = body[key];
  }
  return picked;
}

/**
 * POST /api/quotations
 *
 * accountId always comes from the authenticated caller's own
 * membership (`ctx.accountId`), never from the request body -- the
 * body is untrusted input, and trusting an accountId there would let
 * any agent create quotations under a different tenant's account.
 *
 * `assigned_to` defaults to the caller's own `profiles.id` when the
 * body doesn't specify one. Without this, quotations_select RLS (059)
 * -- admin sees everything, agent only sees rows where
 * `assigned_to = caller's own profiles.id` -- hides every quotation an
 * agent creates from themselves the moment they create it: the list
 * would be permanently empty for any non-admin. An explicit
 * `assignedTo` in the body (e.g. an admin creating on someone else's
 * behalf) always overrides the default. `created_by` is always the
 * caller's own `auth.uid()` (`ctx.userId`) -- it references
 * `auth.users(id)`, not `profiles(id)` (see 059's schema), so it is
 * never taken from the body at all.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();
    if (!body.productCode) {
      return NextResponse.json({ error: 'productCode is required' }, { status: 400 });
    }

    const fields = pickCreateFields(body);

    if (fields.assignedTo === undefined) {
      const { data: profile, error: profileErr } = await ctx.supabase
        .from('profiles')
        .select('id')
        .eq('user_id', ctx.userId)
        .single();
      if (profileErr || !profile) {
        return NextResponse.json({ error: 'Could not resolve caller profile' }, { status: 400 });
      }
      fields.assignedTo = profile.id;
    }

    // pickCreateFields intentionally returns a loose Record (it filters
    // an untyped request body against a runtime allow-list, not a
    // known static shape) -- the cast below is the boundary where that
    // loosely-typed, already-whitelisted data meets createQuotation's
    // real input contract. `productCode` is guaranteed present by the
    // check above.
    const quotation = await createQuotation({
      ...fields,
      accountId: ctx.accountId,
      createdBy: ctx.userId,
    } as CreateQuotationInput);
    return NextResponse.json(quotation, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * GET /api/quotations
 *
 * List, optionally filtered by `status` and/or `dealId`. Same
 * authorization shape as POST above: accountId always comes from
 * `ctx.accountId` (the caller's own membership), never from the query
 * string -- and the query runs through `ctx.supabase`, not the
 * service-role client, so quotations_select RLS (059) is still the
 * backstop even if this filter were ever wrong.
 *
 * The `dealId` filter (Task 14, deal-card entry point) is additive to
 * the account scoping above, not a replacement -- `.eq('account_id', ...)`
 * always applies first, so a caller can never see another account's
 * quotations no matter what `dealId` they pass.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const dealId = url.searchParams.get('dealId');

    let query = ctx.supabase
      .from('quotations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (dealId) query = query.eq('deal_id', dealId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json((data ?? []).map(mapQuotationRow));
  } catch (err) {
    return toErrorResponse(err);
  }
}
