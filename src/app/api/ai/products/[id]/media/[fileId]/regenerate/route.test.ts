import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  captionProductMediaFile: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ai/media-library', () => ({
  captionProductMediaFile: h.captionProductMediaFile,
}))

import { POST } from './route'

function paramsFor(id: string, fileId: string) {
  return { params: Promise.resolve({ id, fileId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('POST /api/ai/products/[id]/media/[fileId]/regenerate', () => {
  it('404s when the file does not exist in this account/product', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'missing'))
    expect(res.status).toBe(404)
  })

  it('500s when the database query fails', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: null, error: new Error('database connection failed') }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    expect(res.status).toBe(500)
  })

  it('400s for a document (nothing to caption)', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'f-1', storage_path: 'p.pdf', mime_type: 'application/pdf', media_kind: 'document' },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    expect(res.status).toBe(400)
  })

  it('422s when captioning fails to produce a description', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'f-1', storage_path: 'p.jpg', mime_type: 'image/jpeg', media_kind: 'image' },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    h.captionProductMediaFile.mockResolvedValue(null)
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    expect(res.status).toBe(422)
  })

  it('200s with the new description on success', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'f-1', storage_path: 'p.jpg', mime_type: 'image/jpeg', media_kind: 'image' },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    h.captionProductMediaFile.mockResolvedValue('A black roller shutter, closed.')
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, ai_description: 'A black roller shutter, closed.' })
  })
})
