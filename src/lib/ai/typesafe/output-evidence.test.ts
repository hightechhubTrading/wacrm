import { beforeEach, expect, it, vi } from 'vitest';
import { judgeSalesOutput } from './output-evidence';
import { outputQuestions, type SalesEvidence } from './sales';
import type { GenerateResult } from '../types';
const h = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  askJev: h.ask,
}));
const reply: GenerateResult = {
  text: 'تقصد شبابيك ألمنيوم أو UPVC؟',
  handoff: false,
  mediaId: null,
  productTagId: null,
  fields: [],
  priority: null,
  priorityReason: null,
  usage: null,
};
const evidence: SalesEvidence = {
  businessContext: null,
  messages: [{ role: 'user', content: 'عندك شبابيك' }],
  collectFields: [],
  knowledge: [
    '[source document=company] Confirmed office: Doha.',
    '[source document=guide] [knowledge_type=customer_guide] General window terminology only.',
  ],
  products: [
    {
      id: 'window',
      name: 'Aluminium windows',
      description: 'Custom windows',
      priceMin: 100,
      priceMax: 150,
      priceUnit: 'per_item',
      priceNotes: 'Excludes motor',
      tagId: null,
      files: [],
      catalog: {
        parent_id: 'glazing',
        kind: 'product',
        status: 'approved',
        aliases: ['شبابيك'],
        specifications: 'Approved frame specification',
        limitations: 'No fire rating approved',
        source_url: null,
        source_notes:
          'INTERNAL REVIEW: collect supplier prices; this is not an approved claim.',
      },
    },
  ],
};
beforeEach(() => {
  h.ask.mockReset();
  h.ask.mockResolvedValue({
    model: 'jev-test',
    answers: {},
    usage: { input_tokens: 1, output_tokens: 1 },
  });
});
it.each([false, true])(
  'keeps internal notes out of approved facts while retaining pricing and hierarchy (advanced=%s)',
  async (behaviorV2Enabled) => {
    const e = { ...evidence, behaviorV2Enabled };
    await judgeSalesOutput(e, reply, outputQuestions(e, reply));
    const state = h.ask.mock.calls[0][0];
    expect(JSON.stringify(state)).not.toContain('INTERNAL REVIEW');
    expect(state.evidence.products[0]).toMatchObject({
      id: 'window',
      priceMin: 100,
      priceMax: 150,
      priceUnit: 'per_item',
      priceNotes: 'Excludes motor',
      catalog: {
        parent_id: 'glazing',
        specifications: 'Approved frame specification',
        limitations: 'No fire rating approved',
        status: 'approved',
      },
    });
    expect(state.evidence.knowledge).toEqual([
      '[source document=company] Confirmed office: Doha.',
    ]);
    expect(state.generalProductKnowledge.guideExcerpts).toEqual([
      evidence.knowledge[1],
    ]);
  }
);
