import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdReferral, recordCtwaAttribution } from './attribution'

type Call = { table: string; op: string; payload?: unknown; args: unknown[] }

function makeDb(opts: { upsertError?: { message: string } } = {}) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [] }
      calls.push(call)
      const builder = {
        upsert(payload: unknown, options: unknown) {
          call.op = 'upsert'
          call.payload = payload
          call.args.push(options)
          return Promise.resolve({ error: opts.upsertError ?? null })
        },
        update(payload: unknown) {
          call.op = 'update'
          call.payload = payload
          return builder
        },
        eq(col: string, val: unknown) {
          call.args.push(['eq', col, val])
          return builder
        },
        or(expr: string) {
          call.args.push(['or', expr])
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

const adReferral = {
  source_type: 'ad',
  source_id: '120240600103070767',
  source_url: 'https://fb.me/x',
  headline: 'Garage doors',
  body: 'Tap to chat',
  ctwa_clid: 'ARAkLkA8rmlFeiCkt',
}

const input = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactWaId: '97455512345',
  messageId: 'wamid.1',
  timestamp: '1759050000',
  referral: adReferral,
}

describe('isAdReferral', () => {
  it('accepts an ad referral with a click id', () => {
    expect(isAdReferral(adReferral)).toBe(true)
  })
  it('rejects missing, non-ad, and clid-less referrals', () => {
    expect(isAdReferral(undefined)).toBe(false)
    expect(isAdReferral({ ...adReferral, source_type: 'post' })).toBe(false)
    expect(isAdReferral({ ...adReferral, ctwa_clid: '' })).toBe(false)
    expect(isAdReferral({ ...adReferral, ctwa_clid: undefined })).toBe(false)
  })
})

describe('recordCtwaAttribution', () => {
  it('stores the attribution idempotently and badges the conversation', async () => {
    const { db, calls } = makeDb()
    await expect(recordCtwaAttribution(db, input)).resolves.toBe(true)

    const upsert = calls.find((c) => c.table === 'ctwa_attributions')!
    expect(upsert.op).toBe('upsert')
    expect(upsert.payload).toEqual({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      contact_wa_id: '97455512345',
      message_id: 'wamid.1',
      ctwa_clid: 'ARAkLkA8rmlFeiCkt',
      ad_id: '120240600103070767',
      headline: 'Garage doors',
      source_url: 'https://fb.me/x',
      raw_referral: adReferral,
      clicked_at: '2025-09-28T09:00:00.000Z',
    })
    expect(upsert.args[0]).toEqual({ onConflict: 'conversation_id,message_id', ignoreDuplicates: true })

    const update = calls.find((c) => c.table === 'conversations')!
    expect(update.payload).toEqual({
      ad_source_id: '120240600103070767',
      ad_headline: 'Garage doors',
      ad_clicked_at: '2025-09-28T09:00:00.000Z',
    })
    expect(update.args).toContainEqual(['eq', 'id', 'conv-1'])
    // Only move the badge forward -- an older click never overwrites a newer one.
    expect(update.args).toContainEqual([
      'or',
      'ad_clicked_at.is.null,ad_clicked_at.lte.2025-09-28T09:00:00.000Z',
    ])
  })

  it('does nothing for a message without an ad referral', async () => {
    const { db, calls } = makeDb()
    await expect(recordCtwaAttribution(db, { ...input, referral: undefined })).resolves.toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('never throws and never logs the click id when the insert fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, calls } = makeDb({ upsertError: { message: 'boom' } })
    await expect(recordCtwaAttribution(db, input)).resolves.toBe(false)
    expect(calls.some((c) => c.table === 'conversations')).toBe(false)
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toContain('ARAkLkA8rmlFeiCkt')
    spy.mockRestore()
  })

  it('falls back to now for an unparseable timestamp', async () => {
    const { db, calls } = makeDb()
    await recordCtwaAttribution(db, { ...input, timestamp: 'nope' })
    const upsert = calls.find((c) => c.table === 'ctwa_attributions')!
    expect(typeof (upsert.payload as { clicked_at: string }).clicked_at).toBe('string')
  })
})
