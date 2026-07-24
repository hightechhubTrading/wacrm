import { NextResponse } from 'next/server'
import {
    getCurrentAccount,
    requireRole,
    toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
   * GET /api/ai/media
   *
   * List the account's media library items (any member). Used by the
   * Media library settings card.
   */
export async function GET() {
    try {
          const { supabase, accountId } = await getCurrentAccount()
          const { data, error } = await supabase
            .from('ai_media_library')
            .select('id, name, product_label, description, media_kind, mime_type, storage_path, updated_at')
            .eq('account_id', accountId)
            .order('updated_at', { ascending: false })
          if (error) {
                  console.error('[ai/media GET] error:', error)
                  return NextResponse.json(
                    { error: 'Failed to load media library' },
                    { status: 500 },
                          )
          }
          return NextResponse.json({ items: data ?? [] })
    } catch (err) {
          return toErrorResponse(err)
    }
}

/**
 * POST /api/ai/media (admin+)
 *
 * Register a media item whose file has ALREADY been uploaded to the
 * `ai-media` storage bucket by the client (see uploadAccountMedia /
 * MEDIA_MAX_BYTES_BY_KIND). This route only writes the DB row that
 * references that upload plus the name/description the AI reads to
 * decide relevance.
 */
export async function POST(request: Request) {
    try {
          const { supabase, accountId, userId } = await requireRole('admin')
          const limit = checkRateLimit(`ai-media:${userId}`, RATE_LIMITS.adminAction)
          if (!limit.success) return rateLimitResponse(limit)

      const body = await request.json().catch(() => null)
          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          const description =
                  typeof body?.description === 'string' ? body.description.trim() : ''
          const productLabel =
                  typeof body?.product_label === 'string' ? body.product_label.trim() : ''
          const storagePath =
                  typeof body?.storage_path === 'string' ? body.storage_path.trim() : ''
          const mimeType =
                  typeof body?.mime_type === 'string' ? body.mime_type.trim() : ''
          const mediaKind =
                  body?.media_kind === 'document' || body?.media_kind === 'image'
              ? body.media_kind
                    : ''
          const fileSize = typeof body?.file_size === 'number' ? body.file_size : null

      if (!name || !description || !storagePath || !mimeType || !mediaKind) {
              return NextResponse.json(
                {
                            error:
                                          'name, description, storage_path, mime_type, and media_kind are required',
                },
                { status: 400 },
                      )
      }

      const { data: item, error } = await supabase
            .from('ai_media_library')
            .insert({
                      account_id: accountId,
                      created_by: userId,
                      name,
                      product_label: productLabel || null,
                      description,
                      storage_path: storagePath,
                      mime_type: mimeType,
                      media_kind: mediaKind,
                      file_size: fileSize,
            })
            .select('id')
            .single()
          if (error || !item) {
                  console.error('[ai/media POST] insert error:', error)
                  return NextResponse.json(
                    { error: 'Failed to save media item' },
                    { status: 500 },
                          )
          }
          return NextResponse.json({ success: true, id: item.id })
    } catch (err) {
          return toErrorResponse(err)
    }
}
