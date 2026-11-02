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
      .eq('account_id', ctx.accountId);
    if (!(
      url.searchParams.get('includeDraft') === 'true' &&
      ['admin', 'owner'].includes(ctx.role)
    ))
      query = query.eq('status', 'active');
    const search = q
      .replace(/[^\p{L}\p{N} +@.-]/gu, '')
      .trim()
      .slice(0, 100);
    if (search)
      query = query.or(
        `name.ilike.%${search}%,name_ar.ilike.%${search}%,sku.ilike.%${search}%`
      );
    const id = url.searchParams.get('id');
    if (id) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id
        )
      )
        return NextResponse.json(
          { error: 'Choose a valid product.' },
          { status: 400 }
        );
      query = query.eq('id', id);
    }
    const category = url.searchParams.get('category');
    if (category) query = query.eq('category', category);
    query = query.order('name');

    const { data, error } = await query.limit(20);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
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
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (
      typeof body.name !== 'string' ||
      body.name.trim().length > 500 ||
      (body.defaultUnitPrice !== undefined &&
        body.defaultUnitPrice !== null &&
        (typeof body.defaultUnitPrice !== 'number' ||
          !Number.isFinite(body.defaultUnitPrice) ||
          body.defaultUnitPrice < 0))
    )
      return NextResponse.json(
        { error: 'Enter a valid product name and price.' },
        { status: 400 }
      );
    const { data: id, error } = await ctx.supabase.rpc(
      'create_shared_catalog_draft',
      {
        p_account: ctx.accountId,
        p_item: {
          name: body.name,
          nameAr: body.nameAr ?? null,
          description: body.description ?? null,
          descriptionAr: body.descriptionAr ?? null,
          sku: body.sku ?? null,
          category: body.category ?? 'product',
          unitOfMeasure: body.unitOfMeasure ?? null,
          defaultUnitPrice: body.defaultUnitPrice ?? null,
        },
      }
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    const { data, error: readError } = await ctx.supabase
      .from('catalog_items')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();
    if (readError)
      return NextResponse.json(
        { error: 'Could not read the shared inventory proposal.' },
        { status: 500 }
      );
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
