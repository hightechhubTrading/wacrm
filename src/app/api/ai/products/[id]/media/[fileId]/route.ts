import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type Params = { params: Promise<{ id: string; fileId: string }> }

/**
 * PATCH /api/ai/products/[id]/media/[fileId] (admin+) -- edit a
 * file's label and/or ai_description. Everything else about a file
 * (its storage object, MIME type, kind) is immutable -- delete and
 * re-add instead.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id, fileId } = await params
    const body = await request.json().catch(() => null)
    if (typeof body?.label !== 'string' && body?.label !== null) {
      return NextResponse.json({ error: "'label' must be a string or null" }, { status: 400 })
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null

    const updatePayload: { label: string | null; ai_description?: string | null } = { label }
    if (Object.prototype.hasOwnProperty.call(body, 'ai_description')) {
      if (typeof body.ai_description !== 'string' && body.ai_description !== null) {
        return NextResponse.json(
          { error: "'ai_description' must be a string or null" },
          { status: 400 },
        )
      }
      updatePayload.ai_description =
        typeof body.ai_description === 'string' && body.ai_description.trim()
          ? body.ai_description.trim()
          : null
    }

    const { data: updated, error } = await supabase
      .from('ai_product_media')
      .update(updatePayload)
      .eq('account_id', accountId)
      .eq('id', fileId)
      .eq('product_id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/products/[id]/media/[fileId] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/products/[id]/media/[fileId] (admin+) -- removes the
 * DB row, then best-effort GCs the underlying storage object.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id, fileId } = await params

    const { data: row } = await supabase
      .from('ai_product_media')
      .select('storage_path')
      .eq('account_id', accountId)
      .eq('id', fileId)
      .eq('product_id', id)
      .maybeSingle()

    const { error } = await supabase
      .from('ai_product_media')
      .delete()
      .eq('account_id', accountId)
      .eq('id', fileId)
      .eq('product_id', id)
    if (error) {
      console.error('[ai/products/[id]/media/[fileId] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
    }

    if (row?.storage_path) {
      await supabase.storage.from('ai-media').remove([row.storage_path])
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
