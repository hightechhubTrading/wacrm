import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  kick: vi.fn(),
  after: vi.fn(),
  adminDeals: null as unknown as { from: (table: string) => unknown },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc, from: (table: string) => mocks.adminDeals.from(table) }),
}))
vi.mock('@/lib/conversions/poller', () => ({ kickConversionSender: mocks.kick }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}))

import { POST } from './route'

interface ScopedOpts {
  conversation?: { id: string } | null
  deal?: { id: string; status: string } | null
  updatedRows?: { id: string }[]
}

function scopedClient({ conversation = { id: 'conv-1' }, deal = { id: 'deal-1', status: 'open' }, updatedRows = [{ id: 'deal-1' }] }: ScopedOpts = {}) {
  const dealUpdates: unknown[] = []
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: table === 'conversations' ? conversation : deal, error: null }),
        update: (patch: unknown) => {
          dealUpdates.push(patch)
          return { eq: () => ({ select: () => Promise.resolve({ data: updatedRows, error: null }) }) }
        },
      })
      return b
    },
  }
  return { client, dealUpdates }
}

function req(body: unknown) {
  return new Request('http://localhost/api/conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// `scoped` is the caller's RLS client (conversation visibility);
// `admin` is the service-role client the route uses for the deal.
let scoped: ReturnType<typeof scopedClient>
let admin: ReturnType<typeof scopedClient>

function useAdmin(opts: ScopedOpts) {
  admin = scopedClient(opts)
  mocks.adminDeals = admin.client
}

beforeEach(() => {
  scoped = scopedClient()
  useAdmin({})
  mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1', accountId: 'acct-1', role: 'agent' })
  mocks.rpc.mockResolvedValue({ error: null })
})

describe('POST /api/conversions', () => {
  it('requires at least agent', async () => {
    await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
  })

  it('returns the auth error for viewers', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden'))
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))
    expect(res.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a missing conversation id or unknown stage', async () => {
    expect((await POST(req({ stage: 'qualified' }))).status).toBe(400)
    expect((await POST(req({ conversation_id: 'conv-1', stage: 'lead' }))).status).toBe(400)
  })

  it('404s when the caller cannot see the conversation', async () => {
    scoped = scopedClient({ conversation: null })
    mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1' })
    const res = await POST(req({ conversation_id: 'conv-9', stage: 'qualified' }))
    expect(res.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('enqueues qualified and kicks the sender after the response', async () => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))
    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_conversion', {
      p_conversation_id: 'conv-1',
      p_stage: 'qualified',
      p_value: null,
      p_currency: null,
      p_deal_id: null,
      p_user_id: 'user-1',
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, 0, -5, 'abc', ''])('rejects Won with value %p', async (value) => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value }))
    expect(res.status).toBe(400)
    expect(admin.dealUpdates).toHaveLength(0)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('marks the linked deal won in QAR and enqueues Purchase', async () => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 45000 }))
    expect(res.status).toBe(200)
    expect(admin.dealUpdates).toEqual([{ value: 45000, currency: 'QAR', status: 'won' }])
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_conversion', expect.objectContaining({
      p_stage: 'won', p_value: 45000, p_currency: 'QAR', p_deal_id: 'deal-1',
    }))
  })

  it('accepts a numeric string value', async () => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: '1200.50' }))
    expect(res.status).toBe(200)
    expect(admin.dealUpdates).toEqual([{ value: 1200.5, currency: 'QAR', status: 'won' }])
  })

  it('won on an already-won deal still returns ok and enqueues idempotently', async () => {
    useAdmin({ deal: { id: 'deal-1', status: 'won' } })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('409s when no deal is linked', async () => {
    useAdmin({ deal: null })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(409)
  })

  it('lets an agent mark Won when they can see the conversation but not its (unassigned) lead deal', async () => {
    // Migration 041 auto-creates the lead deal with no assigned_to, so an
    // agent's RLS client can't see it -- the common case for ad leads.
    scoped = scopedClient({ deal: null })
    mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1' })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(200)
    expect(admin.dealUpdates).toEqual([{ value: 100, currency: 'QAR', status: 'won' }])
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_conversion', expect.objectContaining({ p_deal_id: 'deal-1' }))
  })

  it('500s when the deal update fails', async () => {
    useAdmin({ updatedRows: [] })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(500)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('500s when enqueue fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'db down' } })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'site_visit' }))
    expect(res.status).toBe(500)
  })
})
