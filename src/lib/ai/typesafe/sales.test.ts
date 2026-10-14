import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  assessSalesInput,
  verifySalesOutput,
  type SalesEvidence,
} from './sales';
import { customerStatements } from './policy';
import { jevMode } from './client';
import type { GenerateResult } from '../types';

const h = vi.hoisted(() => ({ ask: vi.fn(), audit: vi.fn() }));
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  askJev: h.ask,
}));
vi.mock('./audit', () => ({ logJevCheck: h.audit }));
const ctx = { accountId: 'account', workflow: 'auto_reply' as const };
const evidence: SalesEvidence = {
  messages: [
    { role: 'user', content: 'I need a roller shutter, 3 metres wide.' },
  ],
  knowledge: [],
  businessContext: null,
  collectFields: [{ id: 'width', name: 'Width', scope: 'contact' }],
  products: [
    {
      id: 'shutter',
      name: 'Roller shutter',
      description: 'Automatic shutter',
      tagId: null,
      priceMin: 350,
      priceMax: 380,
      priceUnit: 'per_meter',
      priceNotes: null,
      files: [
        {
          id: 'photo',
          label: 'Shutter',
          mediaKind: 'image',
          aiDescription: null,
        },
      ],
    },
  ],
};
const proposal: GenerateResult = {
  text: 'Can you share the height?',
  handoff: false,
  mediaId: null,
  productTagId: null,
  fields: [],
  priority: null,
  priorityReason: null,
  usage: null,
};
function output(probabilities: Record<string, number>) {
  return {
    model: 'jev-test',
    usage: { input_tokens: 5, output_tokens: 3 },
    answers: Object.fromEntries(
      Object.entries(probabilities).map(([id, p]) => [
        id,
        { type: 'noul', noul: p },
      ])
    ),
  };
}
beforeEach(() => {
  vi.stubEnv('TYPESAFE_MODE', 'enforce');
  h.ask.mockReset();
  h.audit.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it('is disabled without a key unless enforcement is explicitly configured', () => {
  vi.stubEnv('TYPESAFE_MODE', '');
  vi.stubEnv('TYPESAFE_API_KEY', '');
  expect(jevMode()).toBe('off');
  vi.stubEnv('TYPESAFE_API_KEY', 'local-key');
  expect(jevMode()).toBe('enforce');
});
it('off mode makes no paid calls', async () => {
  vi.stubEnv('TYPESAFE_MODE', 'off');
  expect(await verifySalesOutput(ctx, evidence, proposal)).toBe(proposal);
  expect((await assessSalesInput(ctx, evidence.messages)).guidance).toBe('');
  expect(h.ask).not.toHaveBeenCalled();
});
it('respects an explicit human request before generating prose', async () => {
  h.ask.mockResolvedValue({
    model: 'jev-test',
    usage: { input_tokens: 4, output_tokens: 3 },
    answers: {
      intent: { choice: 'human', confidence: 0.98 },
      human: { noul: 0.99 },
      stuck: { noul: 0.01 },
      emotion: { choice: 'neutral', confidence: 0.98 },
      upset: { noul: 0.01 },
    },
  });
  expect(
    (await assessSalesInput(ctx, [{ role: 'user', content: 'أبي أكلم موظف' }]))
      .handoff
  ).toBe(true);
});
it('does not force handoff for a normal quotation request or uncertain intent', async () => {
  h.ask.mockResolvedValue({
    model: 'jev-test',
    usage: { input_tokens: 4, output_tokens: 3 },
    answers: {
      intent: { choice: 'ready_to_buy', confidence: 0.3 },
      human: { noul: 0.05 },
      stuck: { noul: 0.1 },
      emotion: { choice: 'unclear', confidence: 0.3 },
      upset: { noul: 0.1 },
    },
  });
  const result = await assessSalesInput(ctx, evidence.messages);
  expect(result.handoff).toBe(false);
  expect(result.guidance).toContain('clarification');
});
it.each([
  { emotion: 'angry', confidence: 0.95, upset: 0.7, handoff: true },
  { emotion: 'frustrated', confidence: 0.85, upset: 0.99, handoff: true },
  { emotion: 'disappointed', confidence: 0.9, upset: 0.8, handoff: true },
  { emotion: 'unclear', confidence: 0.2, upset: 0.9, handoff: true },
  { emotion: 'angry', confidence: 0.3, upset: 0.5, handoff: false },
  { emotion: 'concerned', confidence: 0.95, upset: 0.05, handoff: false },
])(
  'routes $emotion at confidence $confidence and upset $upset',
  async ({ emotion, confidence, upset, handoff }) => {
    h.ask.mockResolvedValue({
      model: 'jev-test',
      usage: { input_tokens: 4, output_tokens: 3 },
      answers: {
        intent: { choice: 'product', confidence: 0.95 },
        human: { noul: 0.01 },
        stuck: { noul: 0.01 },
        emotion: { choice: emotion, confidence },
        upset: { noul: upset },
      },
    });
    const result = await assessSalesInput(ctx, evidence.messages);
    expect(result.handoff).toBe(handoff);
    expect(result.apologize).toBe(handoff);
    expect(result.emotion).toEqual({
      emotion,
      confidence,
      upsetProbability: upset,
    });
    if (handoff) expect(result.handoffReason).toContain('human review');
    if (emotion === 'concerned')
      expect(result.guidance).toContain('specific worry');
    expect(h.audit).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        judgments: expect.objectContaining({
          emotion: { choice: emotion, confidence },
          upset,
        }),
      })
    );
  }
);
it('shadow records emotional escalation without changing routing, guidance or apology', async () => {
  vi.stubEnv('TYPESAFE_MODE', 'shadow');
  h.ask.mockResolvedValue({
    model: 'jev-test',
    usage: { input_tokens: 4, output_tokens: 3 },
    answers: {
      intent: { choice: 'complaint', confidence: 0.95 },
      human: { noul: 0.01 },
      stuck: { noul: 0.01 },
      emotion: { choice: 'angry', confidence: 0.98 },
      upset: { noul: 0.99 },
    },
  });
  const result = await assessSalesInput(ctx, evidence.messages);
  expect(result).toMatchObject({
    handoff: false,
    apologize: false,
    guidance: '',
  });
  expect(result.emotion).toBeUndefined();
  expect(h.audit).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ outcome: 'handoff', mode: 'shadow' })
  );
});
it('requires human review when an emotion judgment is missing or invalid', async () => {
  h.ask.mockResolvedValue({
    model: 'jev-test',
    usage: { input_tokens: 4, output_tokens: 3 },
    answers: {
      intent: { choice: 'product', confidence: 0.95 },
      human: { noul: 0.01 },
      stuck: { noul: 0.01 },
    },
  });
  const result = await assessSalesInput(ctx, evidence.messages);
  expect(result).toMatchObject({ handoff: true, guidance: '' });
  expect(result.apologize).toBeUndefined();
  expect(h.audit).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ outcome: 'unavailable' })
  );
});
it('rejects dismissive tone even when business facts are supported', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, responsive: 0.99, empathy: 0.1 })
  );
  const result = await verifySalesOutput(
    ctx,
    {
      ...evidence,
      emotion: {
        emotion: 'concerned',
        confidence: 0.95,
        upsetProbability: 0.1,
      },
    },
    { ...proposal, text: 'Stop worrying and buy it already.' }
  );
  expect(result.handoff).toBe(true);
  expect(result.text).toBe('');
});
it('accepts a patient reply for confusion without forcing human review', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, responsive: 0.99, empathy: 0.99 })
  );
  const result = await verifySalesOutput(
    ctx,
    {
      ...evidence,
      emotion: { emotion: 'confused', confidence: 0.95, upsetProbability: 0.1 },
    },
    proposal
  );
  expect(result.handoff).toBe(false);
});
it('accepts a grounded useful reply', async () => {
  h.ask.mockResolvedValue(output({ grounded: 0.99, responsive: 0.95 }));
  expect((await verifySalesOutput(ctx, evidence, proposal)).handoff).toBe(
    false
  );
});
it.each([0.01, 0.5, 0.84])(
  'hands off when claim support is inadequate (%s)',
  async (grounded) => {
    h.ask.mockResolvedValue(output({ grounded, responsive: 0.99 }));
    const result = await verifySalesOutput(ctx, evidence, {
      ...proposal,
      text: 'Installation is guaranteed tomorrow.',
    });
    expect(result.handoff).toBe(true);
    expect(result.text).toBe('');
  }
);
it('filters unsupported fields/media independently from a good reply', async () => {
  h.ask.mockResolvedValue(
    output({
      grounded: 0.99,
      responsive: 0.99,
      media: 0.2,
      product: 0.99,
      field_0: 0.2,
    })
  );
  const result = await verifySalesOutput(ctx, evidence, {
    ...proposal,
    mediaId: 'photo',
    productTagId: 'shutter',
    fields: [{ name: 'Width', value: '5m' }],
  });
  expect(result.handoff).toBe(false);
  expect(result.mediaId).toBeNull();
  expect(result.fields).toEqual([]);
  expect(result.productTagId).toBe('shutter');
});
it('rejects an unknown identifier even when the model accepts it', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, responsive: 0.99, product: 0.99, media: 0.99 })
  );
  const result = await verifySalesOutput(ctx, evidence, {
    ...proposal,
    productTagId: 'other-account',
    mediaId: 'absent',
  });
  expect(result.productTagId).toBeNull();
  expect(result.mediaId).toBeNull();
});
it('never grants a write to an unknown or ambiguous field name', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, responsive: 0.99, field_0: 0.99, field_1: 0.99 })
  );
  const result = await verifySalesOutput(
    ctx,
    {
      ...evidence,
      collectFields: [
        ...evidence.collectFields,
        { id: 'second-width', name: 'Width', scope: 'deal' },
      ],
    },
    {
      ...proposal,
      fields: [
        { name: 'Width', value: '3m' },
        { name: 'Secret', value: 'yes' },
      ],
    }
  );
  expect(result.fields).toEqual([]);
});
it('checks generated fields on handoff too', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, responsive: 0.99, field_0: 0.1 })
  );
  const result = await verifySalesOutput(ctx, evidence, {
    ...proposal,
    text: '',
    handoff: true,
    fields: [{ name: 'Width', value: '8m' }],
  });
  expect(result.handoff).toBe(true);
  expect(result.fields).toEqual([]);
});
it('shadow mode observes rejections without changing the proposal', async () => {
  vi.stubEnv('TYPESAFE_MODE', 'shadow');
  h.ask.mockResolvedValue(output({ grounded: 0.05, responsive: 0.2 }));
  expect(await verifySalesOutput(ctx, evidence, proposal)).toBe(proposal);
  expect(h.audit).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ outcome: 'handoff', mode: 'shadow' })
  );
});
it.each(['network', 'malformed'])(
  'does not treat an unavailable check as approval (%s)',
  async (failure) => {
    if (failure === 'network')
      h.ask.mockRejectedValue(new Error('private request body'));
    else
      h.ask.mockResolvedValue(
        output({ grounded: Number.NaN, responsive: 0.99 })
      );
    const result = await verifySalesOutput(ctx, evidence, {
      ...proposal,
      fields: [{ name: 'Width', value: '3m' }],
    });
    expect(result.handoff).toBe(true);
    expect(result.fields).toEqual([]);
    expect(h.audit).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ outcome: 'unavailable' })
    );
  }
);
it('retains customer measurements but excludes inferred image details', () => {
  expect(
    customerStatements([
      { role: 'user', content: '3 m\n[Image: 5m wall.]' },
      { role: 'user', content: '[Image: 2m door.]' },
      { role: 'assistant', content: 'Budget 9000' },
    ])
  ).toEqual(['3 m']);
});

describe('review-derived Jev checks', () => {
  it('observes document/scope checks in shadow without blocking a permitted reply', async () => {
    vi.stubEnv('TYPESAFE_SALES_V2_MODE', 'shadow');
    h.ask.mockResolvedValue(
      output({
        grounded: 0.99,
        responsive: 0.99,
        documents: 0.1,
        completion: 0.1,
        scope: 0.1,
        requests: 0.1,
      })
    );
    expect((await verifySalesOutput(ctx, evidence, proposal)).handoff).toBe(
      false
    );
    expect(h.audit.mock.lastCall?.[1].judgments.documents).toBe(0.1);
  });
  it('blocks unsupported document access independently after explicit v2 enforcement', async () => {
    vi.stubEnv('TYPESAFE_SALES_V2_MODE', 'enforce');
    h.ask.mockResolvedValue(
      output({
        grounded: 0.99,
        responsive: 0.99,
        documents: 0.1,
        completion: 0.99,
        scope: 0.99,
        requests: 0.99,
      })
    );
    const result = await verifySalesOutput(ctx, evidence, {
      ...proposal,
      text: 'I read all your drawings.',
    });
    expect(result.handoff).toBe(true);
    expect(result.text).toBe('');
  });
  it('does not create buying work for an explicit customer deferral', async () => {
    vi.stubEnv('TYPESAFE_SALES_V2_MODE', 'enforce');
    h.ask.mockResolvedValue({
      model: 'jev-test',
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        intent: { choice: 'deferred', confidence: 0.99 },
        emotion: { choice: 'neutral', confidence: 0.99 },
        upset: { noul: 0.01 },
        human: { noul: 0.01 },
        stuck: { noul: 0.01 },
        action: { choice: 'inspection', confidence: 0.99 },
        deferred: { noul: 0.99 },
        wrong_contact: { noul: 0.01 },
      },
    });
    const result = await assessSalesInput(ctx, [
      {
        role: 'user',
        content: 'I will finish the garage and contact you later',
      },
    ]);
    expect(result.suppressSales).toBe(true);
    expect(result.followupKind).toBeUndefined();
    expect(result.guidance).toContain('Respect');
  });
  it('keeps unparsed documents out of customer field evidence', () => {
    expect(
      customerStatements([
        {
          role: 'user',
          content: '[File sent: plan.dwg]',
          attachmentState: 'unavailable',
        },
        {
          role: 'user',
          content: '[Extracted document text: Width=500]',
          attachmentState: 'parsed',
        },
      ])
    ).toEqual([]);
  });
});
