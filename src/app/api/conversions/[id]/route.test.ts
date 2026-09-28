import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), adminUpdate: vi.fn(), adminEq: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (patch: unknown) => {
        mocks.adminUpdate(patch)
        return { eq: mocks.adminEq }
      },
    }),
  }),
}))

import { DELETE } from './route'

function scoped(row: { id: string } | null) {
  const b: Record<string, unknown> = {}
  Object.assign(b, { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: row, error: null }) })
  return { from: () => b }
}

const params = { params: Promise.resolve({ id: 'ev-1' }) }
const req = () => new Request('http://localhost/api/conversions/ev-1', { method: 'DELETE' })

beforeEach(() => {
  mocks.adminEq.mockResolvedValue({ error: null })
})

describe('DELETE /api/conversions/[id]', () => {
  it('404s when the event is not visible to the caller', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: scoped(null) })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(404)
    expect(mocks.adminUpdate).not.toHaveBeenCalled()
  })

  it('marks the tag undone without deleting it', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: scoped({ id: 'ev-1' }) })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
    expect(mocks.adminUpdate).toHaveBeenCalledWith({ undone_at: expect.any(String) })
    expect(mocks.adminEq).toHaveBeenCalledWith('id', 'ev-1')
  })
})
