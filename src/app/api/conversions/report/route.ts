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
const PAGE_SIZE = 1000

/** PostgREST caps a read at max_rows (1000); page until a short page. */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

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
    const attrs = await fetchAllPages<AttributionForReport>((from, to) =>
      db
        .from('ctwa_attributions')
        .select('conversation_id, ad_id, headline, clicked_at')
        .eq('account_id', ctx.accountId)
        .gte('clicked_at', fromIso)
        .lte('clicked_at', toIso)
        .order('id')
        .range(from, to),
    )

    // Account-wide rather than `.in(conversation_ids)`: hundreds of UUIDs
    // would overflow the GET URL. Tagged events are few (one per stage per
    // conversation), and buildAdReport drops those outside the range.
    const events = await fetchAllPages<EventForReport>((from, to) =>
      db
        .from('conversion_events')
        .select('conversation_id, stage, value, undone_at')
        .eq('account_id', ctx.accountId)
        .order('id')
        .range(from, to),
    )

    const { data: failed, error: failedError } = await db
      .from('conversion_events')
      .select('id, conversation_id, stage, attempts, last_error, last_attempt_at')
      .eq('account_id', ctx.accountId)
      .eq('status', 'failed')
      .order('last_attempt_at', { ascending: false })
      .limit(100)
    if (failedError) throw failedError

    return NextResponse.json({
      rows: buildAdReport(attrs, events),
      failed: (failed ?? []) as FailedSend[],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
