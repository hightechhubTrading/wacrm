import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { captionProductMediaFile } from '@/lib/ai/media-library'

type Params = { params: Promise<{ id: string; fileId: string }> }

/**
 * POST /api/ai/products/[id]/media/[fileId]/regenerate (admin+)
 *
 * Re-runs AI captioning for one existing product image -- used to
 * backfill photos uploaded before vision was configured, or to retry
 * after a bad/failed caption. Unlike the upload-time captioning in
 * POST .../media (best-effort, silent on failure), this is an
 * explicit user action, so a failure is reported rather than
 * swallowed.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-products-media-regenerate:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id: productId, fileId } = await params
    const { data: file, error } = await supabase
      .from('ai_product_media')
      .select('id, storage_path, mime_type, media_kind')
      .eq('account_id', accountId)
      .eq('id', fileId)
      .eq('product_id', productId)
      .maybeSingle()
    if (error || !file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (file.media_kind !== 'image') {
      return NextResponse.json({ error: 'Only images can be captioned' }, { status: 400 })
    }

    const description = await captionProductMediaFile(supabase, accountId, {
      id: file.id,
      storagePath: file.storage_path,
      mimeType: file.mime_type,
      mediaKind: file.media_kind,
    })
    if (description === null) {
      return NextResponse.json(
        {
          error:
            'Could not generate a description. Check that photo analysis is enabled and configured in Agent settings.',
        },
        { status: 422 },
      )
    }
    return NextResponse.json({ success: true, ai_description: description })
  } catch (err) {
    return toErrorResponse(err)
  }
}
