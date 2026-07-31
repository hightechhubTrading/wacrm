import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/media/[id] -- full item (any member).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data, error } = await supabase
      .from('ai_media_library')
      .select('id, name, product_label, description, price_min, price_max, price_unit, price_notes, media_kind, mime_type, storage_path, updated_at')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[ai/media/[id] GET] error:', error)
      return NextResponse.json({ error: 'Failed to load item' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/media/[id] (admin+) -- edit name/description/product
 * label. Re-uploading the file itself isn't supported here -- delete
 * and re-add the item instead. Whenever the name or product label
 * changes, the linked product tag (product_label || name) is
 * re-resolved (find-or-create) so it stays in sync -- see PATCH's
 * sibling in media/route.ts for the same logic on create.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)

    const update: Record<string, string | number | null> = {}
    if (typeof body?.name === 'string') update.name = body.name.trim()
    if (typeof body?.description === 'string') {
      update.description = body.description.trim()
    }
    if (typeof body?.product_label === 'string') {
      update.product_label = body.product_label.trim() || null
    }
    if ('price_min' in (body ?? {})) {
      update.price_min =
        typeof body.price_min === 'number' && Number.isFinite(body.price_min)
          ? body.price_min
          : null
    }
    if ('price_max' in (body ?? {})) {
      update.price_max =
        typeof body.price_max === 'number' && Number.isFinite(body.price_max)
          ? body.price_max
          : null
    }
    if (typeof body?.price_unit === 'string' || body?.price_unit === null) {
      update.price_unit =
        typeof body.price_unit === 'string' && body.price_unit.trim()
          ? body.price_unit.trim()
          : null
    }
    if (typeof body?.price_notes === 'string' || body?.price_notes === null) {
      update.price_notes =
        typeof body.price_notes === 'string' && body.price_notes.trim()
          ? body.price_notes.trim()
          : null
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    {
      const nextMin = 'price_min' in update ? update.price_min : undefined
      const nextMax = 'price_max' in update ? update.price_max : undefined
      if (
        typeof nextMin === 'number' &&
        typeof nextMax === 'number' &&
        nextMax < nextMin
      ) {
        return NextResponse.json(
          { error: 'price_max must be greater than or equal to price_min' },
          { status: 400 },
        )
      }
    }
    if ('name' in update && !update.name) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    if ('description' in update && !update.description) {
      return NextResponse.json(
        { error: 'description cannot be empty' },
        { status: 400 },
      )
    }

    if ('name' in update || 'product_label' in update) {
      try {
        const { data: current } = await supabase
          .from('ai_media_library')
          .select('name, product_label')
          .eq('account_id', accountId)
          .eq('id', id)
          .maybeSingle()
        const effectiveName = 'name' in update ? update.name : current?.name ?? null
        const effectiveLabel =
          'product_label' in update
            ? update.product_label
            : current?.product_label ?? null
        const tagName = effectiveLabel || effectiveName
        if (tagName) {
          const { tagIdByKey } = await resolveImportTagIds(supabase, {
            accountId,
            userId,
            tagNames: [tagName],
            canCreateTags: true,
          })
          update.tag_id = tagIdByKey.get(tagName.toLowerCase()) ?? null
        }
      } catch (err) {
        console.error('[ai/media/[id] PATCH] tag resolution failed:', err)
      }
    }

    const { data: updated, error } = await supabase
      .from('ai_media_library')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/media/[id] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/media/[id] (admin+) -- removes the DB row, then
 * best-effort GCs the underlying storage object so deleted items don't
 * linger in the public `ai-media` bucket.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { data: row } = await supabase
      .from('ai_media_library')
      .select('storage_path')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()

    const { error } = await supabase
      .from('ai_media_library')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/media/[id] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
    }

    if (row?.storage_path) {
      await supabase.storage.from('ai-media').remove([row.storage_path])
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
