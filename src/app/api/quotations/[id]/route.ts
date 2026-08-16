import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { saveQuotationItems } from '@/lib/quotations/crud';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';

type Params = { params: Promise<{ id: string }> };

// Explicit allow-list for `body.fields` on PATCH. Without this, the
// entire body.fields object was passed straight to
// `.update(body.fields)`, letting a caller set subtotal/total/
// discount_amount directly and bypass computeQuotationTotals entirely.
// `status` is included so a quotation can move draft -> sent/won/lost/
// expired at all (nothing else in the codebase currently writes it) --
// wave 2 wires an actual UI control to it; this just makes the API
// accept it as a legitimate field.
//
// Disallowed/unknown keys are silently dropped rather than rejected
// with a 400 -- consistent with how saveQuotationItems already treats
// extra fields on quotation_items (see 060's payload mapping, which
// only reads the columns it knows about and ignores the rest).
const PATCHABLE_QUOTATION_FIELDS = [
  'client_name',
  'client_phone',
  'client_company',
  'location',
  'project_name',
  'subject',
  'valid_until',
  'status',
  'contact_id',
  'deal_id',
  'assigned_to',
] as const;

function pickPatchableFields(fields: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of PATCHABLE_QUOTATION_FIELDS) {
    if (key in fields) picked[key] = fields[key];
  }
  return picked;
}

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
      // Caught locally (rather than left to bubble up to the outer
      // toErrorResponse) so a save failure here gets the same honest
      // 400-with-real-message treatment as the body.fields branch
      // below, instead of collapsing to a generic 500 -- saveQuotationItems
      // throws a plain Error (the RPC's Postgres message), which carries
      // no `.status` for toErrorResponse's generic handling to key off.
      try {
        await saveQuotationItems(id, ctx.accountId, body.items, body.orderDiscount);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save quotation items';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    if (body.fields) {
      // Goes through ctx.supabase (not the admin client) so
      // quotations_update RLS still gates which fields an agent
      // (vs. admin) may touch on a quotation they don't own. Filtered
      // through PATCHABLE_QUOTATION_FIELDS first -- see comment above.
      const patchable = pickPatchableFields(body.fields);
      if (Object.keys(patchable).length > 0) {
        const { error } = await ctx.supabase.from('quotations').update(patchable).eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      }
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
