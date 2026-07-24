import { NextResponse } from 'next/server'
import {
    getCurrentAccount,
    requireRole,
    toErrorResponse,
} from '@/lib/auth/account'

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
            .select('id, name, product_label, description, media_kind, mime_type, storage_path, updated_at')
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
 * and re-add the item instead.
 */
export async function PATCH(request: Request, { params }: Params) {
    try {
          const { supabase, accountId } = await requireRole('admin')
          const { id } = await params
          const body = await request.json().catch(() => null)

      const update: Record<string, string | null> = {}
            if (typeof body?.name === 'string') update.name = body.name.trim()
          if (typeof body?.description === 'string') {
                  update.description = body.description.trim()
          }
          if (typeof body?.product_label === 'string') {
                  update.product_label = body.product_label.trim() || null
          }
          if (Object.keys(update).length === 0) {
                  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
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
