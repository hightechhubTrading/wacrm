import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/waha/config
 *
 * Any member may read whether the group-notification connection is
 * set up. The encrypted key is never returned — only a `has_api_key`
 * flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('waha_config')
      .select('base_url, api_key, session_name, group_chat_id, is_active')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[waha/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load WAHA configuration' },
        { status: 500 },
      )
    }

    if (!data) return NextResponse.json({ configured: false })

    const { api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_api_key: !!api_key,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/waha/config  (admin+)
 *
 * Upsert the account's WAHA connection (self-hosted WhatsApp HTTP API,
 * used only to post structured messages into an internal group — see
 * src/lib/notifications/waha-client.ts). When `api_key` is omitted the
 * existing stored key is reused (the form sends it only when the admin
 * re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`waha-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const baseUrl =
      typeof body.base_url === 'string' ? body.base_url.trim() : ''
    if (!baseUrl) return bad('base_url is required')
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return bad('base_url must be an http(s) URL')
      }
    } catch {
      return bad('base_url must be a valid URL')
    }

    const sessionName =
      typeof body.session_name === 'string' && body.session_name.trim()
        ? body.session_name.trim()
        : 'default'

    const groupChatId =
      typeof body.group_chat_id === 'string' ? body.group_chat_id.trim() : ''
    if (!groupChatId) return bad('group_chat_id is required')
    if (!groupChatId.endsWith('@g.us')) {
      return bad('group_chat_id must be a group id ending in "@g.us"')
    }

    const isActive = body.is_active === true

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    const { data: existing } = await supabase
      .from('waha_config')
      .select('id, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!rawKey && !existing?.api_key) {
      return bad('api_key is required')
    }

    const shared: Record<string, unknown> = {
      base_url: baseUrl,
      session_name: sessionName,
      group_chat_id: groupChatId,
      is_active: isActive,
    }
    if (rawKey) shared.api_key = encrypt(rawKey)

    if (existing) {
      const { error: upErr } = await supabase
        .from('waha_config')
        .update(shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[waha/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save WAHA configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('waha_config').insert({
        account_id: accountId,
        created_by: userId,
        ...shared,
      })
      if (insErr) {
        console.error('[waha/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save WAHA configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/waha/config  (admin+)
 *
 * Removes the account's WAHA config (turns group notifications off
 * and forgets the key).
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('waha_config')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[waha/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete WAHA configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
