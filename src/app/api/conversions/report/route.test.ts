import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), selects: [] as string[], filters: [] as unknown[] }))

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
      const done = Promise.resolve({ data: fixtures[table], error: null })
      Object.assign(b, {
        select: (cols: string) => { mocks.selects.push(`${table}:${cols}`); return b },
        eq: (...a: unknown[]) => { mocks.filters.push([table, 'eq', ...a]); return b },
        gte: (...a: unknown[]) => { mocks.filters.push([table, 'gte', ...a]); return b },
        lte: (...a: unknown[]) => { mocks.filters.push([table, 'lte', ...a]); return b },
        in: () => b,
        order: () => b,
        limit: () => done,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done.then(res, rej),
      })
      return b
    },
  }),
}))

import { GET } from './route'

beforeEach(() => {
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
})
