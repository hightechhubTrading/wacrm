import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// ------------------------------------------------------------
// GET/POST /api/quotation-product-codes
//
// Both routes go through `requireRole('agent')` — the floor needed
// to even read the list — and then execute through `ctx.supabase`
// (the SSR client, RLS-scoped to the caller), NOT `supabaseAdmin()`.
// That's deliberate: a service-role client bypasses RLS entirely,
// which would silently defeat the `quotation_product_codes_write`
// policy (migration 059) that restricts inserts to admin/owner.
// Routing through `ctx.supabase` means Postgres itself enforces the
// admin-only write — a non-admin agent's POST is rejected by the DB,
// surfaced here as a 400 with the DB's own error message, consistent
// with how every other route in this feature forwards Postgres
// errors rather than re-implementing the check in application code.
// ------------------------------------------------------------

export async function GET(_request: Request) {
  try {
    const ctx = await requireRole('agent');
    const { data, error } = await ctx.supabase
      .from('quotation_product_codes')
      .select('*')
      .eq('account_id', ctx.accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();
    // quotation_product_codes_write RLS (059) requires 'admin' — a
    // non-admin agent's insert is rejected by Postgres itself here, not
    // by application code.
    const { error } = await ctx.supabase.from('quotation_product_codes').insert({
      account_id: ctx.accountId,
      code: body.code,
      label: body.label,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
