import { describe, expect, it } from 'vitest';
import { buildQuotationHtml } from './build-html';
import type { Quotation, QuotationItem } from './types';

const quotation: Quotation = {
  id: 'q-1', accountId: 'acc-1', reference: 'HT-26-RSD-015', revision: 0, status: 'draft',
  clientName: null, clientPhone: null, clientCompany: 'Al Sulaiti Villas', location: null,
  projectName: null, subject: 'Roll Up Shutter', currency: 'QAR', contactId: null, dealId: null,
  assignedTo: null, discountType: null, discountValue: null, subtotal: 3600, discountAmount: 0,
  total: 3600, validUntil: '2026-03-07', pdfStoragePath: null,
};
const items: QuotationItem[] = [{
  id: 'i-1', quotationId: 'q-1', parentItemId: null, productId: null, position: 0, itemType: 'line',
  kind: null, itemCode: 'D01', description: 'Electric roll-up door', descriptionAr: null,
  sizeW: 3.66, sizeH: 2.6, qty: 1, unitPrice: 3600, discountType: null, discountValue: null, lineTotal: 3600,
}];

describe('buildQuotationHtml', () => {
  it('substitutes the reference and total into the template', () => {
    const html = buildQuotationHtml(quotation, items);
    expect(html).toContain('HT-26-RSD-015');
    expect(html).toContain('Al Sulaiti Villas');
    expect(html).toContain('Electric roll-up door');
  });

  it('includes the bilingual amount in words for the total', () => {
    const html = buildQuotationHtml(quotation, items);
    expect(html).toContain('Three Thousand Six Hundred Qatari Riyals only');
    // Brief's original assertion here was 'ثلاثة آلاف وستمئة ريال قطري فقط لا غير'
    // (فقط moved to just before لا غير). That string does not match what
    // amountInWordsBilingual actually produces — number-to-words.test.ts
    // (Task 2's own test) asserts amountInWordsBilingual(3600).ar ===
    // 'فقط ثلاثة آلاف وستمئة ريال قطري لا غير' (فقط at the front). Asserting
    // the brief's original ordering here would require reimplementing
    // word-order logic outside of Task 2 just to satisfy a typo. Corrected
    // to match Task 2's actual, already-tested contract. See task-8-report.md.
    expect(html).toContain('فقط ثلاثة آلاف وستمئة ريال قطري لا غير');
  });

  it('does not leave any unfilled template placeholder in the output', () => {
    const html = buildQuotationHtml(quotation, items);
    expect(html).not.toContain('________________');
  });
});
