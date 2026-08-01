import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/ai/products/[id]/media (admin+)
 *
 * Register a file whose upload has ALREADY happened to the `ai-media`
 * storage bucket by the client (see uploadAccountMedia /
 * MEDIA_MAX_BYTES_BY_KIND) -- mirrors the old /api/ai/media POST's
 * upload-then-register flow, now scoped under a product.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-products-media:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id: productId } = await params
    const body = await request.json().catch(() => null)
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    const storagePath = typeof body?.storage_path === 'string' ? body.storage_path.trim() : ''
    const mimeType = typeof body?.mime_type === 'string' ? body.mime_type.trim() : ''
    const mediaKind =
      body?.media_kind === 'document' || body?.media_kind === 'image' ? body.media_kind : ''
    const fileSize = typeof body?.file_size === 'number' ? body.file_size : null

    if (!storagePath || !mimeType || !mediaKind) {
      return NextResponse.json(
        { error: 'storage_path, mime_type, and media_kind are required' },
        { status: 400 },
      )
    }

    const { data: product } = await supabase
      .from('ai_products')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', productId)
      .maybeSingle()
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { data: item, error } = await supabase
      .from('ai_product_media')
      .insert({
        product_id: productId,
        account_id: accountId,
        label: label || null,
        storage_path: storagePath,
        mime_type: mimeType,
        media_kind: mediaKind,
        file_size: fileSize,
      })
      .select('id')
      .single()
    if (error || !item) {
      console.error('[ai/products/[id]/media POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: item.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
