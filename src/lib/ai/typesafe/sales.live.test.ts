import { describe, expect, it, vi } from 'vitest';
import {
  assessSalesInput,
  verifySalesOutput,
  type SalesEvidence,
} from './sales';
import type { GenerateResult } from '../types';

// Explicit opt-in only. Synthetic fixtures; never run paid calls in normal CI.
const h = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('./audit', () => ({ logJevCheck: h.audit }));
const ctx = {
  accountId: 'synthetic-evaluation',
  workflow: 'playground' as const,
};
const product = {
  id: 'shutter',
  name: 'Automatic roller shutter',
  description: 'Automatic aluminium roller shutter',
  tagId: null,
  priceMin: 350,
  priceMax: 380,
  priceUnit: 'per square metre',
  priceNotes: null,
  files: [],
};
const base: SalesEvidence = {
  messages: [],
  knowledge: [],
  products: [product],
  collectFields: [],
  businessContext:
    'We sell automatic aluminium roller shutters. A salesperson confirms final quotations and appointments.',
  currency: 'QAR',
};
const proposed = (text: string): GenerateResult => ({
  text,
  handoff: false,
  mediaId: null,
  productTagId: 'shutter',
  fields: [],
  priority: null,
  priorityReason: null,
  usage: null,
});

describe.runIf(process.env.TYPESAFE_LIVE_TEST === 'true')(
  'Jev synthetic sales evaluation',
  () => {
    it.each([
      {
        name: 'English estimate',
        customer:
          'What is the estimated price of your automatic aluminium roller shutter?',
        reply:
          'The estimate is QAR 350–380 per square metre. The team will confirm the final quote after checking the measurements.',
        blocked: false,
      },
      {
        name: 'Gulf Arabic estimate',
        customer: 'بكم الشتر الألمنيوم الأوتوماتيك تقريباً؟',
        reply:
          'السعر التقديري من 350 إلى 380 ريال قطري للمتر المربع. الفريق يؤكد العرض النهائي بعد مراجعة المقاسات.',
        blocked: false,
      },
      {
        name: 'invented discount',
        customer: 'What is the price of your automatic roller shutter?',
        reply: 'We can give you 50% off today and install it free tomorrow.',
        blocked: true,
      },
      {
        name: 'wrong amount',
        customer: 'How much is your automatic roller shutter?',
        reply: 'The estimate is QAR 150 per square metre.',
        blocked: true,
      },
      {
        name: 'repeated answered question',
        customer:
          'Automatic aluminium shutter. The opening is 3m wide and 2m high.',
        reply: 'Do you want manual or automatic? What is the width?',
        blocked: true,
      },
    ])(
      '$name',
      async ({ customer, reply, blocked }) => {
        const result = await verifySalesOutput(
          ctx,
          { ...base, messages: [{ role: 'user', content: customer }] },
          proposed(reply)
        );
        expect(result.handoff, JSON.stringify(h.audit.mock.lastCall?.[1])).toBe(
          blocked
        );
      },
      20000
    );
    it('respects a Gulf Arabic request for a person', async () => {
      const result = await assessSalesInput(ctx, [
        { role: 'user', content: 'أبي أكلم موظف المبيعات، مو البوت' },
      ]);
      expect(result.handoff).toBe(true);
    }, 20000);
    it.each([
      {
        name: 'English anger',
        customer:
          'This is unacceptable! I am angry with your terrible service.',
        handoff: true,
      },
      {
        name: 'Gulf Arabic anger',
        customer: 'خدمتكم سيئة وأنا معصب منكم، مو معقول هالتعامل!',
        handoff: true,
      },
      {
        name: 'frustration',
        customer:
          'I am really frustrated. Nobody is listening and I keep getting nowhere with you.',
        handoff: true,
      },
      {
        name: 'Gulf Arabic frustration',
        customer: 'تعبت منكم، كل مرة نفس السالفة ولا أحد يسمعني!',
        handoff: true,
      },
      {
        name: 'sarcastic dissatisfaction',
        customer:
          'Great service. Three days waiting and still no answer. Thanks for absolutely nothing.',
        handoff: true,
      },
      {
        name: 'disappointment',
        customer:
          'I am disappointed with the installation your team did. This is not what was agreed.',
        handoff: true,
      },
      {
        name: 'confusion',
        customer:
          'I am confused about how the per-square-metre price works. Could you explain it simply?',
        handoff: false,
      },
      {
        name: 'worry',
        customer:
          'I am worried whether the shutter is suitable for my garage. Can you explain the options?',
        handoff: false,
      },
      {
        name: 'polite repair',
        customer:
          'My shutter is not opening. Could you help arrange a repair please?',
        handoff: false,
      },
      {
        name: 'price negotiation',
        customer:
          'That is a bit expensive for my budget. Do you have a lower-priced option?',
        handoff: false,
      },
      {
        name: 'urgent capitals',
        customer:
          'PLEASE SEND THE SHUTTER SPECIFICATIONS TODAY. I need them for my meeting.',
        handoff: false,
      },
    ])(
      '$name emotion routing',
      async ({ customer, handoff }) => {
        const result = await assessSalesInput(ctx, [
          { role: 'user', content: customer },
        ]);
        const judgments = JSON.stringify(h.audit.mock.lastCall?.[1]);
        expect(result.handoff, judgments).toBe(handoff);
        expect(result.apologize, judgments).toBe(handoff);
        expect(result.emotion, judgments).toBeDefined();
      },
      20000
    );
    it('uses the latest tone after earlier anger has been resolved', async () => {
      const result = await assessSalesInput(ctx, [
        {
          role: 'user',
          content: 'Your service is awful. I am angry about the delay.',
        },
        { role: 'assistant', content: 'The team has reviewed your concern.' },
        {
          role: 'user',
          content:
            'Thank you, the team sorted it out and I am happy now. Please send the shutter colour options.',
        },
      ]);
      expect(result.handoff, JSON.stringify(h.audit.mock.lastCall?.[1])).toBe(
        false
      );
      expect(result.apologize).toBe(false);
    }, 20000);
    it.each([
      {
        name: 'patient explanation',
        reply:
          'I understand your concern. Which garage opening size should we check so the team can advise on suitability?',
        blocked: false,
      },
      {
        name: 'dismissive upsell',
        reply:
          'Stop worrying, just buy the shutter already. You are wasting our time.',
        blocked: true,
      },
    ])(
      '$name tone validation',
      async ({ reply, blocked }) => {
        const result = await verifySalesOutput(
          ctx,
          {
            ...base,
            messages: [
              {
                role: 'user',
                content:
                  'I am worried whether the shutter is suitable for my garage. Can you help?',
              },
            ],
            emotion: {
              emotion: 'concerned',
              confidence: 0.95,
              upsetProbability: 0.05,
            },
          },
          { ...proposed(reply), productTagId: null }
        );
        expect(result.handoff, JSON.stringify(h.audit.mock.lastCall?.[1])).toBe(
          blocked
        );
      },
      20000
    );
    it('helps a quotation request without treating it as a demand for a human', async () => {
      const result = await assessSalesInput(ctx, [
        {
          role: 'user',
          content:
            'Please send me a quotation for an automatic roller shutter, 3m by 2m.',
        },
      ]);
      expect(result.handoff).toBe(false);
      expect(result.guidance).toBeTruthy();
    }, 20000);
  }
);

describe.runIf(process.env.TYPESAFE_LIVE_TEST === 'true')(
  'Review-derived synthetic regression cases',
  () => {
    it.each([
      {
        name: 'file receipt is not document access',
        customer: 'I sent villa.dwg. Please compare materials.',
        reply: 'I read your drawings and calculated every opening.',
        blocked: true,
      },
      {
        name: 'preserve corrected window count',
        customer:
          'Actually five windows including the stair window. Quote all five.',
        reply: 'Here is your total for four windows.',
        blocked: true,
      },
      {
        name: 'no fictional appointment confirmation',
        customer: 'Can a technician visit tomorrow afternoon?',
        reply: 'Your appointment is confirmed for tomorrow at 3pm.',
        blocked: true,
      },
      {
        name: 'respect explicit inspection request',
        customer: 'I want a site inspection for my windows.',
        reply: 'Which area is the property in?',
        blocked: false,
      },
      {
        name: 'answer both material and location requests',
        customer: 'Are the doors UPVC or WPVC? Where is your showroom?',
        reply: 'Hello! How can I help?',
        blocked: true,
      },
      {
        name: 'conditional offers are not completed appointments',
        customer: 'Can I have a site inspection?',
        reply:
          'The team needs to review your inspection request. Which area is the property in?',
        blocked: false,
      },
    ])(
      '$name',
      async ({ customer, reply, blocked }) => {
        const result = await verifySalesOutput(
          ctx,
          {
            ...base,
            messages: [{ role: 'user', content: customer }],
            memory: { statements: [], actions: [] },
          },
          { ...proposed(reply), productTagId: null }
        );
        expect(result.handoff, JSON.stringify(h.audit.mock.lastCall?.[1])).toBe(
          blocked
        );
      },
      20000
    );
  }
);
