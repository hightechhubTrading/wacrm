import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * GET /api/catalog-items?q=<search>
 *
 * Search-as-you-type for the item-tree editor. Scoped to the
 * caller's own account via `ctx.accountId` -- RLS (catalog_items_select,
 * migration 059) enforces this independently, but we also filter
 * explicitly so the query itself never reaches across tenants.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';

    let query = ctx.supabase
      .from('catalog_items')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('status', 'active');
    if (q) query = query.ilike('name', `%${q}%`);

    const { data, error } = await query.limit(20);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/catalog-items
 *
 * "Save this custom item to the catalog for reuse" action from the
 * item editor. `accountId`/`created_by` always come from the
 * authenticated caller's own context (`ctx.accountId` / `ctx.userId`),
 * never from the request body -- the body is untrusted input.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from('catalog_items')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        category: body.category ?? 'product',
        name: body.name,
        name_ar: body.nameAr ?? null,
        description: body.description ?? null,
        description_ar: body.descriptionAr ?? null,
        sku: body.sku ?? null,
        default_unit_price: body.defaultUnitPrice ?? null,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
