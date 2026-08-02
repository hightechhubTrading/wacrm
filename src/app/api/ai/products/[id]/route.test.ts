import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  resolveImportTagIds: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds: h.resolveImportTagIds,
}))

import { GET, PATCH, DELETE } from './route'

beforeEach(() => vi.clearAllMocks())

describe('DELETE /api/ai/products/[id]', () => {
  it('deletes the product and GCs its files from storage', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = {
      from: (table: string) => {
        if (table === 'ai_product_media') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ data: [{ storage_path: 'library/f-1.jpg' }], error: null }),
              }),
            }),
          }
        }
        return {
          delete: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        }
      },
      storage: { from: () => ({ remove }) },
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const res = await DELETE(new Request('http://x'), { params: Promise.resolve({ id: 'p-1' }) })
    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(['library/f-1.jpg'])
  })
})

describe('PATCH /api/ai/products/[id]', () => {
  it('returns 404 when the product is not in this account', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'New name' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/ai/products/[id]', () => {
  it('returns 404 when not found', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }
    h.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})
