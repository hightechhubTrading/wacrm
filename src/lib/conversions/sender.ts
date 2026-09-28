import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { buildCapiPayload, postCapiEvent, readCapiConfig, type CapiConfig, type CapiResult } from './meta-capi'
import type { ConversionEventRow } from './stages'

/** Delay before the next try, indexed by attempts already made (1-based). */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]

export function nextAttemptAt(attempts: number, now: number = Date.now()): string {
  const idx = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1
  return new Date(now + BACKOFF_MS[idx]).toISOString()
}

interface SenderDeps {
  db?: SupabaseClient
  fetchImpl?: typeof fetch
  env?: Record<string, string | undefined>
  limit?: number
  now?: () => number
  /** Pause between retries of the post-send status write. */
  retryDelayMs?: number
}

const SENT_WRITE_ATTEMPTS = 3

/**
 * Outbox sender: claim due `conversion_events` rows (atomic, SKIP
 * LOCKED -- see claim_conversion_events in migration 065), POST each to
 * Meta, and mark it sent or failed. `sent` rows are never claimed, so a
 * row can't be double-counted by Meta (which doesn't dedupe these).
 */
export async function runConversionSender(deps: SenderDeps = {}): Promise<{ sent: number; failed: number }> {
  const cfg = readCapiConfig(deps.env ?? process.env)
  if (!cfg) return { sent: 0, failed: 0 }

  const db = deps.db ?? supabaseAdmin()
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now

  const { data, error } = await db.rpc('claim_conversion_events', { p_limit: deps.limit ?? 20 })
  if (error) {
    console.error('[capi] claim failed:', error.message)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0
  for (const row of (data ?? []) as ConversionEventRow[]) {
    const result = await sendOne(db, row, cfg, fetchImpl)
    if (result.ok) {
      sent++
      // Meta already has this event and doesn't dedupe, so losing this
      // write would let the row be reclaimed and sent twice once its
      // lease expires. Retry it; delivery is still at-least-once if the
      // DB stays down, so make that loud.
      const patch = { status: 'sent', sent_at: new Date(now()).toISOString(), meta_response: result.response, last_error: null }
      let writeError: { message: string } | null = null
      for (let attempt = 1; attempt <= SENT_WRITE_ATTEMPTS; attempt++) {
        ;({ error: writeError } = await db.from('conversion_events').update(patch).eq('id', row.id))
        if (!writeError) break
        if (attempt < SENT_WRITE_ATTEMPTS) await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 500))
      }
      if (writeError) {
        console.error('[capi] event', row.id, 'was delivered to Meta but could not be marked sent — it may be resent:', writeError.message)
      }
    } else {
      failed++
      console.warn('[capi] send failed for event', row.id, 'attempt', row.attempts, result.error)
      await db
        .from('conversion_events')
        .update({ status: 'failed', last_error: result.error, next_attempt_at: nextAttemptAt(row.attempts, now()) })
        .eq('id', row.id)
    }
  }
  return { sent, failed }
}

async function sendOne(
  db: SupabaseClient,
  row: ConversionEventRow,
  cfg: CapiConfig,
  fetchImpl: typeof fetch,
): Promise<CapiResult> {
  if (!row.attribution_id) return { ok: false, error: 'No ad attribution for this event' }
  const { data } = await db
    .from('ctwa_attributions')
    .select('ctwa_clid')
    .eq('id', row.attribution_id)
    .maybeSingle()
  const clid = (data as { ctwa_clid?: string } | null)?.ctwa_clid
  if (!clid) return { ok: false, error: 'Attribution missing ctwa_clid' }
  return postCapiEvent(buildCapiPayload(row, clid, cfg), cfg, fetchImpl)
}
