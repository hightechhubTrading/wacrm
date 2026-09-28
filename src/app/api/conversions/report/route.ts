import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  buildAdReport,
  type AttributionForReport,
  type EventForReport,
  type FailedSend,
} from '@/lib/conversions/report'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/conversions/report?from=YYYY-MM-DD&to=YYYY-MM-DD (admin+)
 *
 * Per-ad lead quality for conversations whose ad click falls in the range
 * (UTC days, default: last 30 days), plus the account's failed sends.
 * Uses the service role because ctwa_attributions has no client policies;
 * every query is scoped to ctx.accountId and never selects ctwa_clid.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const url = new URL(request.url)
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    if ((fromParam && !DATE_RE.test(fromParam)) || (toParam && !DATE_RE.test(toParam))) {
      return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
    }
    const fromIso = fromParam
      ? `${fromParam}T00:00:00.000Z`
      : new Date(Date.now() - 30 * 86_400_000).toISOString()
    const toIso = toParam ? `${toParam}T23:59:59.999Z` : new Date().toISOString()

    const db = supabaseAdmin()
    const { data: attrs, error: attrError } = await db
      .from('ctwa_attributions')
      .select('conversation_id, ad_id, headline, clicked_at')
      .eq('account_id', ctx.accountId)
      .gte('clicked_at', fromIso)
      .lte('clicked_at', toIso)
    if (attrError) throw attrError

    const conversationIds = [...new Set((attrs ?? []).map((a) => a.conversation_id as string))]
    let events: EventForReport[] = []
    if (conversationIds.length > 0) {
      const { data, error } = await db
        .from('conversion_events')
        .select('conversation_id, stage, value, undone_at')
        .eq('account_id', ctx.accountId)
        .in('conversation_id', conversationIds)
      if (error) throw error
      events = (data ?? []) as EventForReport[]
    }

    const { data: failed, error: failedError } = await db
      .from('conversion_events')
      .select('id, conversation_id, stage, attempts, last_error, last_attempt_at')
      .eq('account_id', ctx.accountId)
      .eq('status', 'failed')
      .order('last_attempt_at', { ascending: false })
      .limit(100)
    if (failedError) throw failedError

    return NextResponse.json({
      rows: buildAdReport((attrs ?? []) as AttributionForReport[], events),
      failed: (failed ?? []) as FailedSend[],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
