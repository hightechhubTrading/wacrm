import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  config: vi.fn(),
  context: vi.fn(),
  knowledge: vi.fn(),
  generate: vi.fn(),
  input: vi.fn(),
  output: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.role,
  toErrorResponse: () => new Response('{}', { status: 500 }),
}));
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.config }));
vi.mock('@/lib/ai/context', () => ({ buildConversationContext: h.context }));
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.knowledge }));
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generate }));
vi.mock('@/lib/ai/typesafe/sales', () => ({
  assessSalesInput: h.input,
  verifySalesOutput: h.output,
}));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn() }));
import { POST } from './route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
const request = () =>
  new Request('http://localhost/api/ai/draft', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: 'conversation' }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTests();
  h.role.mockResolvedValue({
    accountId: 'acct',
    userId: 'user',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'conversation' },
              error: null,
            }),
          }),
        }),
      }),
    },
  });
  h.config.mockResolvedValue({
    systemPrompt: 'Business facts',
    provider: 'openai',
  });
  h.context.mockResolvedValue([{ role: 'user', content: 'Price?' }]);
  h.knowledge.mockResolvedValue(['Confirmed knowledge']);
  h.input.mockResolvedValue({
    handoff: false,
    guidance: 'Answer pricing directly.',
  });
  h.generate.mockResolvedValue({ text: 'A draft', usage: null });
  h.output.mockResolvedValue({ text: 'Verified draft', handoff: false });
});
it('returns only the checked draft with intent guidance in the generation prompt', async () => {
  const response = await POST(request());
  expect(await response.json()).toEqual({ draft: 'Verified draft' });
  expect(h.generate.mock.calls[0][0].systemPrompt).toContain(
    'Answer pricing directly.'
  );
  expect(h.output.mock.calls[0][1]).toMatchObject({
    knowledge: ['Confirmed knowledge'],
  });
});
it('requires human review before generation for an explicit human request', async () => {
  h.input.mockResolvedValue({ handoff: true });
  const response = await POST(request());
  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe('ai_human_review');
  expect(h.generate).not.toHaveBeenCalled();
});
it('does not expose a rejected reply to the composer', async () => {
  h.output.mockResolvedValue({ text: '', handoff: true });
  const response = await POST(request());
  expect(response.status).toBe(422);
  expect(await response.json()).not.toHaveProperty('draft');
});
it('checks conversation visibility before calling Jev', async () => {
  h.role.mockResolvedValue({
    accountId: 'acct',
    userId: 'user',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    },
  });
  expect((await POST(request())).status).toBe(404);
  expect(h.input).not.toHaveBeenCalled();
});
