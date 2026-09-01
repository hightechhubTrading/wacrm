import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  resolveImportTagIds: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds: h.resolveImportTagIds,
}))

import { GET, POST } from './route'

function fakeSupabase(opts: {
  listData?: unknown[] | null
  listError?: unknown
  insertData?: unknown
  insertError?: unknown
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({ data: opts.listData ?? null, error: opts.listError ?? null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({ data: opts.insertData ?? null, error: opts.insertError ?? null }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('GET /api/ai/products', () => {
  it('lists products with nested files', async () => {
    h.getCurrentAccount.mockResolvedValue({
      supabase: fakeSupabase({
        listData: [
          {
            id: 'p-1',
            name: 'Rollup Shutter door',
            description: 'Aluminum rollup shutters',
            tag_label: 'Shutters',
            price_min: 350,
            price_max: 1200,
            price_unit: 'per_meter',
            price_notes: null,
            updated_at: '2026-08-01T00:00:00Z',
            ai_product_media: [{ id: 'f-1', label: 'front', media_kind: 'image', mime_type: 'image/jpeg', storage_path: 'x' }],
          },
        ],
      }),
      accountId: 'acc-1',
    })
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].files).toHaveLength(1)
  })

  it('requests ai_description in the select clause', async () => {
    const selectSpy = vi.fn().mockReturnValue({
      eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    })
    h.getCurrentAccount.mockResolvedValue({
      supabase: { from: () => ({ select: selectSpy }) },
      accountId: 'acc-1',
    })
    await GET()
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('ai_description'))
  })
})

describe('POST /api/ai/products', () => {
  it('rejects a price range with max < min', async () => {
    h.requireRole.mockResolvedValue({ supabase: fakeSupabase({}), accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', description: 'Y', price_min: 350, price_max: 120 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('creates a product with no files and resolves a tag', async () => {
    h.requireRole.mockResolvedValue({
      supabase: fakeSupabase({ insertData: { id: 'p-new' } }),
      accountId: 'acc-1',
      userId: 'u-1',
    })
    h.resolveImportTagIds.mockResolvedValue({ tagIdByKey: new Map([['pool fence', 'tag-9']]) })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pool fence', description: 'Safety fencing' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, id: 'p-new' })
  })
})
