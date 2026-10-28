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
      Object.entries({ education: 0.99, ...probabilities }).map(([id, p]) => [
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
  {
    emotion: 'angry',
    confidence: 0.98,
    upset: 0.98,
    handoff: true,
    apologize: true,
  },
  {
    emotion: 'angry',
    confidence: 0.95,
    upset: 0.7,
    handoff: false,
    apologize: true,
  },
  {
    emotion: 'frustrated',
    confidence: 0.85,
    upset: 0.99,
    handoff: false,
    apologize: true,
  },
  {
    emotion: 'disappointed',
    confidence: 0.9,
    upset: 0.8,
    handoff: false,
    apologize: true,
  },
  {
    emotion: 'unclear',
    confidence: 0.2,
    upset: 0.9,
    handoff: false,
    apologize: true,
  },
  {
    emotion: 'angry',
    confidence: 0.3,
    upset: 0.5,
    handoff: false,
    apologize: false,
  },
  {
    emotion: 'concerned',
    confidence: 0.95,
    upset: 0.05,
    handoff: false,
    apologize: false,
  },
])(
  'routes $emotion at confidence $confidence and upset $upset',
  async ({ emotion, confidence, upset, handoff, apologize }) => {
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
    expect(result.apologize).toBe(apologize);
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
it('uses cautious generation with output verification when input judgments are unavailable', async () => {
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
  expect(result.handoff).toBe(false);
  expect(result.guidance).toContain('must still pass output verification');
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

it.each([false, true])(
  'only transfers a repetition complaint after a failed recovery (%s)',
  async (failed) => {
    h.ask.mockResolvedValue({
      model: 'jev-test',
      usage: { input_tokens: 4, output_tokens: 3 },
      answers: {
        intent: { choice: 'complaint', confidence: 0.95 },
        human: { noul: 0.01 },
        stuck: { noul: 0.98 },
        emotion: { choice: 'frustrated', confidence: 0.9 },
        upset: { noul: 0.95 },
        recovery_failed: { noul: failed ? 0.98 : 0.05 },
      },
    });
    const result = await assessSalesInput(ctx, evidence.messages);
    expect(result.handoff).toBe(failed);
    expect(result.apologize).toBe(true);
    if (!failed) expect(result.guidance).toContain('Recover this conversation');
  }
);

it('rewrites a rejected candidate once and verifies the replacement before allowing it', async () => {
  h.ask
    .mockResolvedValueOnce(output({ grounded: 0.4, responsive: 0.99 }))
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.99 }));
  const repair = vi.fn().mockResolvedValue({
    ...proposal,
    text: 'Which area is the installation in?',
  });
  const result = await verifySalesOutput(
    ctx,
    evidence,
    { ...proposal, text: 'Installation is guaranteed tomorrow.' },
    repair
  );
  expect(repair).toHaveBeenCalledTimes(1);
  expect(repair.mock.calls[0][0]).toContain(
    'Keep company-specific claims supported'
  );
  expect(repair.mock.calls[0][0]).not.toContain(
    'missed an independent request'
  );
  expect(h.ask).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({
    handoff: false,
    text: 'Which area is the installation in?',
  });
});
it('never loops or sends the second candidate if its claims still fail', async () => {
  h.ask.mockResolvedValue(output({ grounded: 0.2, responsive: 0.99 }));
  const repair = vi.fn().mockResolvedValue({
    ...proposal,
    text: 'Booked for tomorrow.',
    fields: [{ name: 'Width', value: 'invented' }],
  });
  const result = await verifySalesOutput(ctx, evidence, proposal, repair);
  expect(repair).toHaveBeenCalledTimes(1);
  expect(result.handoff).toBe(true);
  expect(result.text).toBe('');
  expect(result.fields).toEqual([]);
});
it('does not retry a good candidate or a justified human transfer', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, responsive: 0.99, handoff_needed: 0.99 })
  );
  const repair = vi.fn();
  await verifySalesOutput(ctx, evidence, proposal, repair);
  await verifySalesOutput(
    ctx,
    evidence,
    { ...proposal, text: '', handoff: true },
    repair
  );
  expect(repair).not.toHaveBeenCalled();
});
it('recovers from a transient output-check failure but never approves an unchecked replacement', async () => {
  h.ask
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.99 }));
  const repair = vi.fn().mockResolvedValue(proposal);
  expect(
    (await verifySalesOutput(ctx, evidence, proposal, repair)).handoff
  ).toBe(false);
  expect(repair).toHaveBeenCalledTimes(1);
});
it('preserves filtered fields if the rewrite provider fails', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.2, responsive: 0.99, field_0: 0.1 })
  );
  const result = await verifySalesOutput(
    ctx,
    evidence,
    { ...proposal, fields: [{ name: 'Width', value: 'invented' }] },
    async () => {
      throw new Error('provider unavailable');
    }
  );
  expect(result).toMatchObject({ handoff: true, text: '', fields: [] });
});

it('keeps unverified replies blocked after two output service failures', async () => {
  h.ask.mockRejectedValue(new Error('timeout'));
  const repair = vi.fn().mockResolvedValue(proposal);
  const result = await verifySalesOutput(ctx, evidence, proposal, repair);
  expect(result).toMatchObject({
    handoff: true,
    text: '',
    fields: [],
    mediaId: null,
    productTagId: null,
  });
  expect(repair).toHaveBeenCalledTimes(1);
  expect(h.ask).toHaveBeenCalledTimes(2);
});
it('shadow mode never invokes paid regeneration for a rejected candidate', async () => {
  vi.stubEnv('TYPESAFE_MODE', 'shadow');
  h.ask.mockResolvedValue(output({ grounded: 0.1, responsive: 0.1 }));
  const repair = vi.fn();
  expect(await verifySalesOutput(ctx, evidence, proposal, repair)).toBe(
    proposal
  );
  expect(repair).not.toHaveBeenCalled();
});

it('gives recovery all enforced failures but excludes shadow-only failures', async () => {
  const scores = {
    grounded: 0.99,
    responsive: 0.3,
    documents: 0.2,
    completion: 0.1,
    scope: 0.4,
    requests: 0.2,
  };
  vi.stubEnv('TYPESAFE_SALES_V2_MODE', 'enforce');
  h.ask.mockResolvedValue(output(scores));
  const repair = vi.fn().mockResolvedValue(proposal);
  await verifySalesOutput(ctx, evidence, proposal, repair);
  const guidance = repair.mock.calls[0][0];
  expect(guidance).toContain('repeated an answered question');
  expect(guidance).toContain('unavailable attachment content');
  expect(guidance).toContain('unsupported completed operation');
  expect(guidance).toContain('changed or omitted');
  expect(guidance).toContain('missed an independent request');
  vi.stubEnv('TYPESAFE_SALES_V2_MODE', 'shadow');
  repair.mockClear();
  await verifySalesOutput(ctx, evidence, proposal, repair);
  expect(repair.mock.calls[0][0]).toContain('repeated an answered question');
  expect(repair.mock.calls[0][0]).not.toContain(
    'unsupported completed operation'
  );
});

it('repairs an unjustified generated handoff for an ordinary product question', async () => {
  h.ask
    .mockResolvedValueOnce(
      output({ grounded: 0.99, responsive: 0.99, handoff_needed: 0.05 })
    )
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.99 }));
  const repair = vi.fn().mockResolvedValue(proposal);
  const result = await verifySalesOutput(
    ctx,
    evidence,
    { ...proposal, text: '', handoff: true },
    repair
  );
  expect(repair).toHaveBeenCalledOnce();
  expect(result.handoff).toBe(false);
  expect(result.routingDecision?.reason).toBe('verified_reply');
});
it('verifies a bounded clarification after two unresponsive shutter candidates', async () => {
  const e = {
    ...evidence,
    messages: [
      {
        role: 'user' as const,
        content: 'How much money do you meter for the work of Shatar?',
      },
    ],
  };
  h.ask
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.77 }))
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.81 }))
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.98 }));
  const result = await verifySalesOutput(
    ctx,
    e,
    proposal,
    vi.fn().mockResolvedValue(proposal)
  );
  expect(result.handoff).toBe(false);
  expect(result.text).toContain('window shutters');
  expect(result.fields).toEqual([]);
  expect(result.routingDecision?.attempt).toBe(2);
});
it('never sends even the narrow template if its verification fails', async () => {
  h.ask.mockResolvedValue(output({ grounded: 0.99, responsive: 0.7 }));
  const e = {
    ...evidence,
    messages: [{ role: 'user' as const, content: 'Shatar meter price?' }],
  };
  const result = await verifySalesOutput(
    ctx,
    e,
    proposal,
    vi.fn().mockResolvedValue(proposal)
  );
  expect(result.handoff).toBe(true);
  expect(result.text).toBe('');
  expect(h.ask).toHaveBeenCalledTimes(3);
});
it('repairs missing price evidence before the final sender backstop', async () => {
  h.ask
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.99 }))
    .mockResolvedValueOnce(output({ grounded: 0.99, responsive: 0.99 }));
  const repair = vi.fn().mockResolvedValue(proposal);
  const result = await verifySalesOutput(
    ctx,
    evidence,
    { ...proposal, text: 'Estimate QAR 350–380 per metre.' },
    repair
  );
  expect(repair.mock.calls[0][0]).toContain('same-reply product tag');
  expect(result.handoff).toBe(false);
});

it('blocks a false general explanation even when no company evidence rule fails', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.99, education: 0.1, responsive: 0.99 })
  );
  const result = await verifySalesOutput(
    ctx,
    {
      ...evidence,
      messages: [{ role: 'user', content: 'What is a perforated shutter?' }],
    },
    { ...proposal, text: 'Perforated shutters have no openings.' }
  );
  expect(result.handoff).toBe(true);
  expect(result.routingDecision?.failures).toContain('education');
});
it('blocks invented company specifications even when the general explanation passes', async () => {
  h.ask.mockResolvedValue(
    output({ grounded: 0.1, education: 0.99, responsive: 0.99 })
  );
  const result = await verifySalesOutput(ctx, evidence, {
    ...proposal,
    text: 'Solid shutters block views. Ours are fire-rated for two hours.',
  });
  expect(result.handoff).toBe(true);
  expect(result.routingDecision?.failures).toContain('grounded');
});
