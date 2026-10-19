import {
  CATALOG_FIELDS,
  catalogMetadata,
  parseCatalogMetadata,
  catalogPriceError,
} from '@/lib/ai/catalog';
import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';

/**
 * GET /api/ai/products
 *
 * List the account's products, each with its nested files (any
 * member). Used by the product-catalog settings card and the inbox's
 * manual catalog picker.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('ai_products')
      .select(
        `id, name, description, tag_label, price_min, price_max, price_unit, price_notes, updated_at, ${CATALOG_FIELDS}, ai_product_media(id, label, media_kind, mime_type, storage_path, ai_description)`
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('[ai/products GET] error:', error);
      return NextResponse.json(
        { error: 'Failed to load products' },
        { status: 500 }
      );
    }
    const items = (data ?? []).map((row) => ({
      ...catalogMetadata(row),
      id: row.id,
      name: row.name,
      description: row.description,
      tag_label: row.tag_label,
      price_min: row.price_min,
      price_max: row.price_max,
      price_unit: row.price_unit,
      price_notes: row.price_notes,
      updated_at: row.updated_at,
      files: row.ai_product_media ?? [],
    }));
    return NextResponse.json({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai/products (admin+)
 *
 * Create a product with just its info -- no file required (files are
 * added afterward via POST /api/ai/products/[id]/media). Also
 * resolves (find-or-create) a contact tag named after the product --
 * `tag_label` if set, else `name` -- so the auto-reply bot can apply
 * it to a contact when this product is clearly the topic of
 * conversation (see PRODUCT_TAG_SENTINEL_* in lib/ai/defaults.ts).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-products:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    for (const key of ['price_min', 'price_max']) {
      if (
        key in (body ?? {}) &&
        body[key] !== null &&
        (typeof body[key] !== 'number' || !Number.isFinite(body[key]))
      )
        return NextResponse.json(
          { error: 'Price limits must be numbers or empty.' },
          { status: 400 }
        );
    }
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description =
      typeof body?.description === 'string' ? body.description.trim() : '';
    const tagLabel =
      typeof body?.tag_label === 'string' ? body.tag_label.trim() : '';
    const priceMin =
      typeof body?.price_min === 'number' && Number.isFinite(body.price_min)
        ? body.price_min
        : null;
    const priceMax =
      typeof body?.price_max === 'number' && Number.isFinite(body.price_max)
        ? body.price_max
        : null;
    const priceUnit =
      typeof body?.price_unit === 'string' && body.price_unit.trim()
        ? body.price_unit.trim()
        : null;
    const priceNotes =
      typeof body?.price_notes === 'string' && body.price_notes.trim()
        ? body.price_notes.trim()
        : null;

    if (priceMin !== null && priceMax !== null && priceMax < priceMin) {
      return NextResponse.json(
        { error: 'price_max must be greater than or equal to price_min' },
        { status: 400 }
      );
    }

    if (!name || !description) {
      return NextResponse.json(
        { error: 'name and description are required' },
        { status: 400 }
      );
    }

    let metadata;
    try {
      metadata = {
        ...parseCatalogMetadata(body),
        status: body.status ?? 'draft',
      };
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    const priceError = catalogPriceError({
      price_min: priceMin,
      price_max: priceMax,
      price_unit: priceUnit,
      kind: metadata.kind,
    });
    if (priceError)
      return NextResponse.json({ error: priceError }, { status: 400 });
    if (metadata.kind === 'family' && metadata.parent_id)
      return NextResponse.json(
        { error: 'Families must be root entries.' },
        { status: 400 }
      );
    if (metadata.kind === 'variant' && !metadata.parent_id)
      return NextResponse.json(
        { error: 'Choose a parent for this variant.' },
        { status: 400 }
      );

    let tagId: string | null = null;
    const tagName = tagLabel || name;
    try {
      const { tagIdByKey } = await resolveImportTagIds(supabase, {
        accountId,
        userId,
        tagNames: [tagName],
        canCreateTags: true,
      });
      tagId = tagIdByKey.get(tagName.toLowerCase()) ?? null;
    } catch (err) {
      console.error('[ai/products POST] tag resolution failed:', err);
    }

    const { data: item, error } = await supabase
      .from('ai_products')
      .insert({
        ...metadata,
        account_id: accountId,
        created_by: userId,
        name,
        description,
        tag_label: tagLabel || null,
        tag_id: tagId,
        price_min: priceMin,
        price_max: priceMax,
        price_unit: priceUnit,
        price_notes: priceNotes,
      })
      .select('id')
      .single();
    if (error || !item) {
      if (error && ['23514', '23503'].includes(error.code))
        return NextResponse.json(
          { error: 'Choose a valid parent in this account.' },
          { status: 400 }
        );
      console.error('[ai/products POST] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to save product' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, id: item.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
