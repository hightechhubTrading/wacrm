import {
  CATALOG_FIELDS,
  parseCatalogMetadata,
  catalogPriceError,
} from '@/lib/ai/catalog';
import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/ai/products/[id] -- full product + files (any member).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;
    const { data, error } = await supabase
      .from('ai_products')
      .select(
        `id, name, description, tag_label, price_min, price_max, price_unit, price_notes, updated_at, ${CATALOG_FIELDS}, ai_product_media(id, label, media_kind, mime_type, storage_path)`
      )
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('[ai/products/[id] GET] error:', error);
      return NextResponse.json(
        { error: 'Failed to load product' },
        { status: 500 }
      );
    }
    if (!data)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({
      ...data,
      files: data.ai_product_media ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/ai/products/[id] (admin+) -- edit info fields. Files are
 * managed separately (see [id]/media). Whenever name or tag_label
 * changes, the linked contact tag is re-resolved (find-or-create) so
 * it stays in sync -- same logic as POST's create path.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const update: Record<string, string | string[] | number | null> = {};
    try {
      Object.assign(update, parseCatalogMetadata(body ?? {}));
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    if (update.parent_id === id)
      return NextResponse.json(
        { error: 'A product cannot contain itself.' },
        { status: 400 }
      );
    if (typeof body?.name === 'string') update.name = body.name.trim();
    if (typeof body?.description === 'string')
      update.description = body.description.trim();
    if (typeof body?.tag_label === 'string' || body?.tag_label === null) {
      update.tag_label =
        typeof body.tag_label === 'string' && body.tag_label.trim()
          ? body.tag_label.trim()
          : null;
    }
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
    if ('price_min' in (body ?? {})) {
      update.price_min =
        typeof body.price_min === 'number' && Number.isFinite(body.price_min)
          ? body.price_min
          : null;
    }
    if ('price_max' in (body ?? {})) {
      update.price_max =
        typeof body.price_max === 'number' && Number.isFinite(body.price_max)
          ? body.price_max
          : null;
    }
    if (typeof body?.price_unit === 'string' || body?.price_unit === null) {
      update.price_unit =
        typeof body.price_unit === 'string' && body.price_unit.trim()
          ? body.price_unit.trim()
          : null;
    }
    if (typeof body?.price_notes === 'string' || body?.price_notes === null) {
      update.price_notes =
        typeof body.price_notes === 'string' && body.price_notes.trim()
          ? body.price_notes.trim()
          : null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    {
      const nextMin = 'price_min' in update ? update.price_min : undefined;
      const nextMax = 'price_max' in update ? update.price_max : undefined;
      if (
        typeof nextMin === 'number' &&
        typeof nextMax === 'number' &&
        nextMax < nextMin
      ) {
        return NextResponse.json(
          { error: 'price_max must be greater than or equal to price_min' },
          { status: 400 }
        );
      }
    }
    if ('name' in update && !update.name) {
      return NextResponse.json(
        { error: 'name cannot be empty' },
        { status: 400 }
      );
    }
    if ('description' in update && !update.description) {
      return NextResponse.json(
        { error: 'description cannot be empty' },
        { status: 400 }
      );
    }

    if (
      ['price_min', 'price_max', 'price_unit', 'kind', 'parent_id'].some(
        (key) => key in update
      )
    ) {
      const { data: current, error: readError } = await supabase
        .from('ai_products')
        .select('price_min, price_max, price_unit, kind, parent_id')
        .eq('account_id', accountId)
        .eq('id', id)
        .maybeSingle();
      if (readError)
        return NextResponse.json(
          { error: 'Failed to load product.' },
          { status: 500 }
        );
      if (!current)
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const merged = { ...current, ...update };
      const priceError = catalogPriceError(merged);
      if (priceError)
        return NextResponse.json({ error: priceError }, { status: 400 });
      if (merged.kind === 'family' && merged.parent_id)
        return NextResponse.json(
          { error: 'Families must be root entries.' },
          { status: 400 }
        );
      if (merged.kind === 'variant' && !merged.parent_id)
        return NextResponse.json(
          { error: 'Choose a parent for this variant.' },
          { status: 400 }
        );
    }

    if (
      'name' in update ||
      'tag_label' in update ||
      update.status === 'approved'
    ) {
      try {
        const { data: current } = await supabase
          .from('ai_products')
          .select('name, tag_label')
          .eq('account_id', accountId)
          .eq('id', id)
          .maybeSingle();
        const effectiveName =
          'name' in update ? update.name : (current?.name ?? null);
        const effectiveLabel =
          'tag_label' in update
            ? update.tag_label
            : (current?.tag_label ?? null);
        const tagName = String(effectiveLabel || effectiveName || '');
        if (tagName) {
          const { tagIdByKey } = await resolveImportTagIds(supabase, {
            accountId,
            userId,
            tagNames: [tagName],
            canCreateTags: true,
          });
          update.tag_id = tagIdByKey.get(tagName.toLowerCase()) ?? null;
        }
      } catch (err) {
        console.error('[ai/products/[id] PATCH] tag resolution failed:', err);
      }
    }

    const { data: updated, error } = await supabase
      .from('ai_products')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      if (['23514', '23503'].includes(error.code))
        return NextResponse.json(
          {
            error: 'Choose a parent in this account without creating a cycle.',
          },
          { status: 400 }
        );
      console.error('[ai/products/[id] PATCH] error:', error);
      return NextResponse.json(
        { error: 'Failed to update product' },
        { status: 500 }
      );
    }
    if (!updated)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai/products/[id] (admin+) -- removes the product row
 * (ai_product_media rows cascade via FK), then best-effort GCs each
 * removed file's underlying storage object so nothing lingers in the
 * public `ai-media` bucket.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const { data: files } = await supabase
      .from('ai_product_media')
      .select('storage_path')
      .eq('account_id', accountId)
      .eq('product_id', id);

    const { error } = await supabase
      .from('ai_products')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id);
    if (error) {
      if (error.code === '23503')
        return NextResponse.json(
          {
            error:
              'Move or remove linked products and knowledge before deleting this entry.',
          },
          { status: 409 }
        );
      console.error('[ai/products/[id] DELETE] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete product' },
        { status: 500 }
      );
    }

    const paths = (files ?? [])
      .map((f) => f.storage_path as string)
      .filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from('ai-media').remove(paths);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
