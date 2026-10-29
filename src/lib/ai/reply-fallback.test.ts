import { beforeEach, expect, it, vi } from 'vitest';
import { selectReplyFallback } from './reply-fallback';
import type { SalesEvidence } from './typesafe/sales';
const h = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('./typesafe/client', () => ({ askJev: h.ask }));
const evidence: SalesEvidence = {
  intent: 'product',
  messages: [{ role: 'user', content: 'عندك شبابيك' }],
  businessContext: null,
  knowledge: [],
  collectFields: [],
  products: [
    {
      id: 'window',
      name: 'Aluminium windows · نوافذ ألمنيوم',
      description: 'Approved windows',
      tagId: null,
      priceMin: 100,
      priceMax: 150,
      priceUnit: 'per_item',
      priceNotes: null,
      files: [],
      catalog: {
        kind: 'product',
        status: 'approved',
        parent_id: null,
        aliases: ['شبابيك'],
        specifications: '',
        limitations: '',
        source_url: null,
        source_notes: 'Internal review only',
      },
    },
  ],
};
beforeEach(() => {
  h.ask.mockReset();
  h.ask.mockResolvedValue({
    answers: { candidate: { type: 'choice', choice: 'availability_0' } },
  });
});
it('answers basic availability using the approved localized name without tagging a customer selection or offering an unrequested price', async () => {
  const reply = await selectReplyFallback(evidence);
  expect(reply).toMatchObject({
    text: 'نعم، نوفر نوافذ ألمنيوم. وش تبي تعرف؟',
    handoff: false,
    productTagId: null,
    mediaId: null,
    fields: [],
  });
  const state = h.ask.mock.calls[0][0];
  expect(
    Object.keys(state.candidates).some(
      (k) => k.startsWith('price_') || k.startsWith('unknown_price_')
    )
  ).toBe(false);
  expect(JSON.stringify(state)).not.toContain('Internal review only');
});
it('cannot turn a draft catalog item into an approved availability response', async () => {
  const p = evidence.products[0];
  const reply = await selectReplyFallback({
    ...evidence,
    products: [{ ...p, catalog: { ...p.catalog!, status: 'draft' } }],
  });
  expect(reply).toBeNull();
  expect(h.ask.mock.calls[0][0].candidates).not.toHaveProperty(
    'availability_0'
  );
});
