import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), selects: [] as string[], filters: [] as unknown[], inCalls: 0 }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

const fixtures: Record<string, unknown[]> = {
  ctwa_attributions: [{ conversation_id: 'c1', ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-01T10:00:00+00:00' }],
  conversion_events: [{ conversation_id: 'c1', stage: 'qualified', value: null, undone_at: null }],
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {}
      // Like PostgREST max_rows: an unpaginated read returns at most 1000 rows.
      const done = Promise.resolve({ data: (fixtures[table] ?? []).slice(0, 1000), error: null })
      Object.assign(b, {
        select: (cols: string) => { mocks.selects.push(`${table}:${cols}`); return b },
        eq: (...a: unknown[]) => { mocks.filters.push([table, 'eq', ...a]); return b },
        gte: (...a: unknown[]) => { mocks.filters.push([table, 'gte', ...a]); return b },
        lte: (...a: unknown[]) => { mocks.filters.push([table, 'lte', ...a]); return b },
        in: () => { mocks.inCalls++; return b },
        range: (from: number, to: number) =>
          Promise.resolve({ data: (fixtures[table] ?? []).slice(from, to + 1), error: null }),
        order: () => b,
        limit: () => done,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done.then(res, rej),
      })
      return b
    },
  }),
}))

import { GET } from './route'

const baseFixtures = { ...fixtures }

beforeEach(() => {
  Object.assign(fixtures, baseFixtures)
  mocks.inCalls = 0
  mocks.selects.length = 0
  mocks.filters.length = 0
  mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u', role: 'admin' })
})

describe('GET /api/conversions/report', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden'))
    const res = await GET(new Request('http://localhost/api/conversions/report'))
    expect(res.status).toBe(403)
  })

  it('scopes to the account and date range and never selects the click id', async () => {
    const res = await GET(new Request('http://localhost/api/conversions/report?from=2026-09-01&to=2026-09-30'))
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({ ad_id: 'A', conversations: 1, qualified: 1 })
    expect(mocks.selects.join(' ')).not.toContain('ctwa_clid')
    expect(mocks.filters).toContainEqual(['ctwa_attributions', 'eq', 'account_id', 'acct-1'])
    expect(mocks.filters).toContainEqual(['ctwa_attributions', 'gte', 'clicked_at', '2026-09-01T00:00:00.000Z'])
    expect(mocks.filters).toContainEqual(['ctwa_attributions', 'lte', 'clicked_at', '2026-09-30T23:59:59.999Z'])
  })

  it('400s on a malformed date', async () => {
    const res = await GET(new Request('http://localhost/api/conversions/report?from=yesterday'))
    expect(res.status).toBe(400)
  })

  it('reads every row past the 1000-row page limit without putting ids in the URL', async () => {
    fixtures.ctwa_attributions = Array.from({ length: 1500 }, (_, i) => ({
      conversation_id: `c${i}`, ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-01T10:00:00+00:00',
    }))
    fixtures.conversion_events = Array.from({ length: 1200 }, (_, i) => ({
      conversation_id: `c${i}`, stage: 'qualified', value: null, undone_at: null,
    }))
    const res = await GET(new Request('http://localhost/api/conversions/report?from=2026-09-01&to=2026-09-30'))
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({ ad_id: 'A', conversations: 1500, qualified: 1200 })
    expect(mocks.inCalls).toBe(0)
  })
})
