import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireRole: vi.fn(), checkRateLimit: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('POST /api/ai/products/[id]/media', () => {
  it('404s when the product does not exist in this account', async () => {
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
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ storage_path: 'p', mime_type: 'image/jpeg', media_kind: 'image' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('adds a file to an existing product', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'ai_products') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'p-1' }, error: null }),
                }),
              }),
            }),
          }
        }
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'f-new' }, error: null }),
            }),
          }),
        }
      },
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ label: 'front view', storage_path: 'p', mime_type: 'image/jpeg', media_kind: 'image' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'p-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, id: 'f-new' })
  })
})
