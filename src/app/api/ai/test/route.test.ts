import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  validate: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.auth,
  toErrorResponse: () => Response.json({ error: 'auth' }, { status: 403 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }));
vi.mock('@/lib/ai/validate', () => ({ validateAiCredentials: h.validate }));
vi.mock('@/lib/ai/key-health', () => ({ clearKeyError: h.clear }));
import { POST } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({
    accountId: 'acct',
    userId: 'owner',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { provider: 'openai', api_key: 'stored-openai-key' },
            }),
          }),
        }),
      }),
    },
  });
  h.validate.mockResolvedValue(undefined);
  h.clear.mockResolvedValue(undefined);
});
const request = (body: object) =>
  new Request('http://localhost/api/ai/test', {
    method: 'POST',
    body: JSON.stringify(body),
  });
it('never tests another provider with a saved key belonging to OpenAI', async () => {
  const res = await POST(
    request({ provider: 'deepseek', model: 'deepseek-flash' })
  );
  expect(res.status).toBe(400);
  expect(h.validate).not.toHaveBeenCalled();
});
it('allows retesting the saved key with its own provider', async () => {
  const res = await POST(request({ provider: 'openai', model: 'gpt-test' }));
  expect(res.status).toBe(200);
  expect(h.validate).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: 'stored-openai-key', provider: 'openai' })
  );
});
it('tests a supplied DeepSeek key without changing the active account configuration', async () => {
  const res = await POST(
    request({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      api_key: 'new-deepseek-key',
    })
  );
  expect(res.status).toBe(200);
  expect(h.clear).not.toHaveBeenCalled();
  expect(h.validate).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: 'new-deepseek-key',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })
  );
});
