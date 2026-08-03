// Regression test for the "unlimited replies" checkbox bug: saving with
// auto_reply_max_per_conversation: 0 (the "unlimited" sentinel — see
// src/lib/ai/auto-reply.ts and migration 039) was silently clamped back
// up to 1 by a stale [1, 20] validation range left over from before 0
// meant "unlimited", so the checkbox appeared unchecked after reload.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  validateAiCredentials: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: () => Response.json({ error: 'auth failed' }, { status: 403 }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: mocks.validateAiCredentials,
}))

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: vi.fn(),
}))

import { POST } from './route'

function fakeSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { id: 'cfg-1', provider: 'openai', model: 'gpt-4o', api_key: 'enc:key' },
              error: null,
            }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        mocks.update(payload)
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  }
}

function request(body: unknown) {
  return new Request('http://internal.local/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockReturnValue({ success: true })
  mocks.validateAiCredentials.mockResolvedValue(undefined)
  mocks.requireRole.mockResolvedValue({
    supabase: fakeSupabase(),
    accountId: 'acc-1',
    userId: 'user-1',
  })
})

describe('POST /api/ai/config — auto_reply_max_per_conversation', () => {
  it('stores 0 as-is when the client sends the "unlimited" sentinel, instead of clamping it up to 1', async () => {
    const res = await POST(
      request({ provider: 'openai', model: 'gpt-4o', auto_reply_max_per_conversation: 0 }),
    )
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      auto_reply_max_per_conversation: 0,
    })
  })

  it('still clamps a too-large value down to 20', async () => {
    await POST(
      request({ provider: 'openai', model: 'gpt-4o', auto_reply_max_per_conversation: 999 }),
    )
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      auto_reply_max_per_conversation: 20,
    })
  })

  it('defaults to 3 when the value is missing or not a number', async () => {
    await POST(request({ provider: 'openai', model: 'gpt-4o' }))
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      auto_reply_max_per_conversation: 3,
    })
  })
})
