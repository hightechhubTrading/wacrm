import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  config: vi.fn(),
  knowledge: vi.fn(),
  products: vi.fn(),
  input: vi.fn(),
  generate: vi.fn(),
  output: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.role,
  toErrorResponse: () => Response.json({ error: 'auth' }, { status: 403 }),
}));
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.config }));
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.knowledge }));
vi.mock('@/lib/ai/media-library', () => ({
  listProductsForPrompt: h.products,
}));
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generate }));
vi.mock('@/lib/ai/typesafe/sales', () => ({
  assessSalesInput: h.input,
  verifySalesOutput: h.output,
}));
import { POST } from './route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
const request = (content = 'عندك شبابيك') =>
  new Request('http://localhost/api/ai/playground', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
  });
const product = (id: string, name: string) => ({
  id,
  name,
  description: name,
  tagId: null,
  priceMin: null,
  priceMax: null,
  priceUnit: null,
  priceNotes: null,
  files: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTests();
  h.role.mockResolvedValue({
    accountId: 'acct',
    userId: 'agent',
    supabase: {},
  });
  h.config.mockResolvedValue({
    provider: 'openai',
    systemPrompt: 'Answer using approved evidence.',
    companyFacts: 'Office: Doha.',
    behaviorV2Enabled: false,
  });
  h.knowledge.mockResolvedValue([]);
  h.products.mockResolvedValue([
    {
      ...product('window', 'Aluminium windows'),
      catalog: {
        kind: 'product',
        status: 'approved',
        aliases: ['شبابيك'],
        parent_id: null,
        specifications: '',
        limitations: '',
      },
    },
    product('steel', 'Steel entrance doors'),
  ]);
  h.input.mockResolvedValue({
    intent: 'product',
    handoff: false,
    guidance: '',
  });
  h.generate.mockResolvedValue({
    text: 'نوافذ ألمنيوم',
    handoff: false,
    usage: null,
  });
  h.output.mockResolvedValue({ text: 'تقصد نوافذ ألمنيوم؟', handoff: false });
});
it('uses the same relevant approved product scope for generation and verification with advanced behavior off', async () => {
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(
    h.output.mock.calls[0][1].products.map((p: { id: string }) => p.id)
  ).toEqual(['window']);
  expect(h.generate.mock.calls[0][0].systemPrompt).toContain(
    'Aluminium windows'
  );
  expect(h.generate.mock.calls[0][0].systemPrompt).not.toContain(
    'Steel entrance doors'
  );
});
it('reports failed verification as review without claiming a transfer', async () => {
  h.output.mockResolvedValue({
    text: '',
    handoff: false,
    reviewRequired: true,
  });
  const res = await POST(request());
  const body = await res.json();
  expect(res.status).toBe(503);
  expect(body.code).toBe('reply_needs_review');
  expect(body.handoff).toBeUndefined();
});
it('still respects an explicit human request without generating a reply', async () => {
  h.input.mockResolvedValue({ handoff: true, apologize: false });
  const res = await POST(request('أبي موظف'));
  expect(await res.json()).toMatchObject({ handoff: true });
  expect(h.generate).not.toHaveBeenCalled();
});
