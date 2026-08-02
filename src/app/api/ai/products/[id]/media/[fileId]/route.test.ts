import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireRole: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))

import { PATCH, DELETE } from './route'

beforeEach(() => vi.clearAllMocks())

describe('DELETE /api/ai/products/[id]/media/[fileId]', () => {
  it('deletes the row and GCs storage', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { storage_path: 'library/f-1.jpg' }, error: null }),
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        }),
      }),
      storage: { from: () => ({ remove }) },
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const res = await DELETE(new Request('http://x'), {
      params: Promise.resolve({ id: 'p-1', fileId: 'f-1' }),
    })
    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(['library/f-1.jpg'])
  })
})

describe('PATCH /api/ai/products/[id]/media/[fileId]', () => {
  it('updates the label', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'f-1' }, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ label: 'side view' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'p-1', fileId: 'f-1' }) })
    expect(res.status).toBe(200)
  })
})
