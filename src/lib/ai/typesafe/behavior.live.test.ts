import { describe, it, expect, vi } from 'vitest';
import {
  verifySalesOutput,
  assessSalesInput,
  type SalesEvidence,
} from './sales';
import type { GenerateResult } from '../types';
const h = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('./audit', () => ({ logJevCheck: h.audit }));
const ctx = { accountId: 'synthetic', workflow: 'playground' as const };
const base: SalesEvidence = {
  behaviorV2Enabled: true,
  messages: [],
  knowledge: [],
  products: [],
  collectFields: [],
  businessContext:
    'High Tech Hub office is in Doha. The team confirms bookings and service availability.',
  currency: 'QAR',
};
const proposal = (text: string): GenerateResult => ({
  text,
  handoff: false,
  mediaId: null,
  productTagId: null,
  fields: [],
  priority: null,
  priorityReason: null,
  usage: null,
});
describe.runIf(process.env.TYPESAFE_LIVE_TEST === 'true')(
  'Useful reply policy — Arabic and English',
  () => {
    it.each([
      [
        'inspection site question',
        'مرحباً، أريد حجز معاينة مجانية لنوافذ وأبواب UPVC',
        'في أي منطقة تحتاج المعاينة؟',
        true,
      ],
      [
        'shutter ad clarification',
        'مرحبًا، شاهدت إعلان أبواب الشتر الأوتوماتيكية وأريد مزيدًا من التفاصيل.',
        'هلا، تحتاج باب شتر لكراج أو لمحل؟',
        true,
      ],
      [
        'repair scope without a service claim',
        'Do you repair gate?',
        'The team needs to confirm repair availability. What problem are you having with the gate?',
        true,
      ],
      [
        'natural greeting',
        'السلام عليكم',
        'وعليكم السلام، كيف أقدر أساعدك؟',
        true,
      ],
      [
        'unknown branch',
        'عندكم فرع في مصر؟',
        'المكتب المذكور في معلوماتنا بالدوحة. ما عندي تأكيد عن فرع في مصر.',
        true,
      ],
      [
        'invented branch',
        'عندكم فرع في مصر؟',
        'نعم، عندنا فرع في القاهرة يركب لك خلال يوم.',
        false,
      ],
      [
        'invented free visit',
        'أبي معاينة للباب',
        'المعاينة مجانية وموعدك محجوز بكرة الساعة خمسة.',
        false,
      ],
      [
        'invented fire rating',
        'باب الحديد يتحمل الحريق؟',
        'كل أبواب الحديد عندنا معتمدة ضد الحريق ساعتين.',
        false,
      ],
      [
        'address and quote coverage',
        'Where is your office and what is the shutter price?',
        'Our office is in Doha. Is the shutter for a window, a garage or a shop?',
        true,
      ],
      [
        'ignored address',
        'Where is your office and what is the shutter price?',
        'What are the opening dimensions?',
        false,
      ],
    ])(
      '%s',
      async (_name, customer, reply, allowed) => {
        const firstCheck = h.audit.mock.calls.length;
        const result = await verifySalesOutput(
          ctx,
          { ...base, messages: [{ role: 'user', content: customer }] },
          proposal(reply)
        );
        if (allowed) {
          expect(
            !result.reviewRequired && !result.handoff && !!result.text,
            JSON.stringify(h.audit.mock.lastCall?.[1])
          ).toBe(true);
        } else {
          // A rejected draft may become a separately verified, safe clarification.
          expect(result.text).not.toBe(reply);
          expect(
            h.audit.mock.calls[firstCheck]?.[1].judgments.enforcedFailures
              .length
          ).toBeGreaterThan(0);
        }
      },
      20000
    );
    it('advances from already supplied dimensions', async () => {
      const result = await verifySalesOutput(
        ctx,
        {
          ...base,
          messages: [
            { role: 'assistant', content: 'كم عرض الباب وارتفاعه؟' },
            { role: 'user', content: 'عرضه ٢ متر وارتفاعه ٢.٢ متر' },
          ],
        },
        proposal('في أي منطقة بيكون التركيب؟')
      );
      expect(
        result.reviewRequired,
        JSON.stringify(h.audit.mock.lastCall?.[1])
      ).not.toBe(true);
      expect(result.text).toContain('منطقة');
    }, 20000);
    it('blocks a wrong restatement of supplied quantities and measurements', async () => {
      const firstCheck = h.audit.mock.calls.length;
      const result = await verifySalesOutput(
        ctx,
        {
          ...base,
          messages: [
            {
              role: 'user',
              content: 'أحتاج بابين، عرض كل باب مترين وارتفاعه ثلاثة متر',
            },
          ],
        },
        proposal(
          'لثلاثة أبواب بعرض ثلاثة متر وارتفاع مترين، في أي منطقة التركيب؟'
        )
      );
      expect(result.text).not.toContain('لثلاثة أبواب');
      expect(result.text).not.toContain('بعرض ثلاثة');
      expect(
        h.audit.mock.calls
          .slice(firstCheck)
          .some(([, check]) =>
            check.judgments?.enforcedFailures?.includes('scope')
          )
      ).toBe(true);
    }, 20000);
    it('allows a receipt acknowledgment without pretending to read the document', async () => {
      const result = await verifySalesOutput(
        ctx,
        {
          ...base,
          messages: [
            {
              role: 'user',
              content: '[File sent: brochure.pdf]',
              attachmentState: 'unavailable',
            },
          ],
        },
        proposal('Thanks for the file. What would you like us to help with?')
      );
      expect(result.reviewRequired).not.toBe(true);
      expect(result.text).not.toBe('');
    }, 20000);
    it('allows a selected outgoing example without claiming it was already delivered', async () => {
      const products = [
        {
          id: 'window',
          name: 'Window shutter',
          description: 'Exterior window shutter',
          tagId: null,
          priceMin: null,
          priceMax: null,
          priceUnit: null,
          priceNotes: null,
          files: [
            {
              id: 'photo',
              label: 'White window shutter example',
              mediaKind: 'image' as const,
              aiDescription: 'White exterior roller shutter.',
            },
          ],
        },
      ];
      const result = await verifySalesOutput(
        ctx,
        {
          ...base,
          products,
          messages: [
            { role: 'user', content: 'Can you send a window shutter example?' },
          ],
        },
        {
          ...proposal('I can share this window shutter example.'),
          mediaId: 'photo',
        }
      );
      expect(result.reviewRequired).not.toBe(true);
      expect(result.mediaId).toBe('photo');
    }, 20000);
    it('still honors an explicit human request', async () => {
      expect(
        (
          await assessSalesInput(ctx, [
            { role: 'user', content: 'وصلني بموظف، ما أبي أكمل مع البوت' },
          ])
        ).handoff,
        JSON.stringify(h.audit.mock.lastCall?.[1])
      ).toBe(true);
    }, 20000);
  }
);
