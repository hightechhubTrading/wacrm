import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BACKOFF_MS, nextAttemptAt, runConversionSender } from './sender'
import type { ConversionEventRow } from './stages'

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: vi.fn() }))

const env = {
  META_CAPI_ENABLED: 'true',
  META_DATASET_ID: 'ds-1',
  META_WABA_ID: 'waba-1',
  META_CAPI_ACCESS_TOKEN: 'tok',
  GRAPH_API_VERSION: 'v24.0',
}
const NOW = Date.parse('2026-09-28T10:00:00.000Z')

function row(over: Partial<ConversionEventRow> = {}): ConversionEventRow {
  return {
    id: 'ev-1', account_id: 'acct-1', conversation_id: 'conv-1', attribution_id: 'attr-1', deal_id: null,
    stage: 'qualified', meta_event_name: 'QualifiedLead', event_id: 'conv-1:qualified', value: null, currency: null,
    status: 'sending', attempts: 1, next_attempt_at: '', last_attempt_at: null, last_error: null, meta_response: null,
    tagged_by: null, tagged_at: '2026-09-28T09:59:00.000Z', sent_at: null, undone_at: null, ...over,
  }
}

function makeDb(rows: ConversionEventRow[], clid: string | null = 'CLID') {
  const updates: { id: unknown; patch: Record<string, unknown> }[] = []
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  const db = {
    rpc,
    from(table: string) {
      if (table === 'ctwa_attributions') {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () => Promise.resolve({ data: clid ? { ctwa_clid: clid } : null, error: null }),
        }
        return b
      }
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ id, patch })
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }
  return { db: db as unknown as SupabaseClient, updates, rpc }
}

const ok = () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'tr' }), { status: 200 })

describe('nextAttemptAt', () => {
  it('follows the 1m/5m/30m/2h/12h ladder', () => {
    expect(BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000])
    expect(nextAttemptAt(1, NOW)).toBe(new Date(NOW + 60_000).toISOString())
    expect(nextAttemptAt(5, NOW)).toBe(new Date(NOW + 43_200_000).toISOString())
  })
})

describe('runConversionSender', () => {
  it('does nothing (no claim, no fetch) when the flag is off', async () => {
    const { db, rpc } = makeDb([row()])
    const fetchImpl = vi.fn()
    await expect(runConversionSender({ db, fetchImpl, env: { ...env, META_CAPI_ENABLED: 'false' } })).resolves.toEqual({ sent: 0, failed: 0 })
    expect(rpc).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('claims due rows and marks a 2xx as sent with Meta response stored', async () => {
    const { db, updates, rpc } = makeDb([row()])
    const fetchImpl = vi.fn().mockResolvedValue(ok())
    await expect(runConversionSender({ db, fetchImpl, env, now: () => NOW })).resolves.toEqual({ sent: 1, failed: 0 })
    expect(rpc).toHaveBeenCalledWith('claim_conversion_events', { p_limit: 20 })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.data[0].user_data.ctwa_clid).toBe('CLID')
    expect(updates).toEqual([
      {
        id: 'ev-1',
        patch: {
          status: 'sent',
          sent_at: new Date(NOW).toISOString(),
          meta_response: { events_received: 1, fbtrace_id: 'tr' },
          last_error: null,
        },
      },
    ])
  })

  it('marks a 4xx as failed with the error and schedules the next retry', async () => {
    const { db, updates } = makeDb([row({ attempts: 2 })])
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Bad clid', code: 100 } }), { status: 400 }),
    )
    await expect(runConversionSender({ db, fetchImpl, env, now: () => NOW })).resolves.toEqual({ sent: 0, failed: 1 })
    expect(updates[0].patch).toEqual({
      status: 'failed',
      last_error: 'Bad clid (code 100)',
      next_attempt_at: new Date(NOW + 300_000).toISOString(),
    })
  })

  it('fails a row whose attribution clid is gone without calling Meta', async () => {
    const { db, updates } = makeDb([row()], null)
    const fetchImpl = vi.fn()
    await runConversionSender({ db, fetchImpl, env, now: () => NOW })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updates[0].patch.status).toBe('failed')
  })

  it('treats a network rejection as a failed attempt, not a crash', async () => {
    const { db, updates } = makeDb([row()])
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    await expect(runConversionSender({ db, fetchImpl, env, now: () => NOW })).resolves.toEqual({ sent: 0, failed: 1 })
    expect(updates[0].patch.last_error).toBe('fetch failed')
  })
})
