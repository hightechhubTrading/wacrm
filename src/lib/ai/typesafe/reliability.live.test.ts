import { describe, it, expect, vi } from 'vitest';
import { verifySalesOutput, type SalesEvidence } from './sales';
import type { GenerateResult } from '../types';
vi.mock('./audit', () => ({ logJevCheck: vi.fn() }));
const base: SalesEvidence = {
  behaviorV2Enabled: false,
  messages: [],
  products: [],
  collectFields: [],
  knowledge: [],
  businessContext:
    'High Tech Hub supplies doors, windows and roller shutters in Doha. The sales team confirms quotations and repair availability.',
  currency: 'QAR',
};
const candidate = (text: string): GenerateResult => ({
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
  'baseline reply reliability — synthetic only',
  () => {
    it.each([
      [
        'bathroom price without approved price',
        'كم سعر باب الحمام؟',
        'ما عندي سعر معتمد لهذا الباب. تفضله ألمنيوم أو UPVC؟',
        true,
      ],
      [
        'garage price scope',
        'كم تكلفة باب الكراج تقريباً؟',
        'ما عندي سعر معتمد للكراج. تفضله شتر رول أو باب سكشن؟',
        true,
      ],
      [
        'gate repair clarification',
        'أحتاج تصليح بوابة',
        'الفريق يحتاج يتأكد من إمكانية التصليح. ما المشكلة في البوابة؟',
        true,
      ],
      [
        'UPVC ad enquiry',
        'أريد تفاصيل عن نوافذ UPVC',
        'نوافذ UPVC إطاراتها من البلاستيك الصلب، وتختلف حسب طريقة الفتح ونوع الزجاج. تفضلها سحاب أو مفصلية؟',
        true,
      ],
      [
        'invented price',
        'كم سعر باب الحمام؟',
        'سعر باب الحمام 150 ريال شامل التركيب والضمان عشر سنوات.',
        false,
      ],
      [
        'invented booking',
        'أحتاج تصليح بوابة',
        'تم حجز الفني لك غداً الساعة الخامسة مجاناً.',
        false,
      ],
    ])(
      '%s',
      async (_name, customer, text, allowed) => {
        const proposal = candidate(text);
        const result = await verifySalesOutput(
          { accountId: 'synthetic', workflow: 'playground' },
          {
            ...base,
            messages: [{ role: 'user', content: customer as string }],
          },
          proposal
        );
        if (allowed) expect(result).toMatchObject({ text, handoff: false });
        else expect(result.text).not.toBe(text);
      },
      30000
    );
  }
);
