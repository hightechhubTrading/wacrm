import { fillQuotationContext } from './context';
import { describe, expect, it } from 'vitest';
import { draftFromQuotation, draftQuotation, validateDraft } from './workspace';
import { buildQuotationHtml } from './build-html';
import type { QuotationWithItems } from './workspace';
const quote: QuotationWithItems = {
  id: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  reference: 'HT-26-PIV-042',
  revision: 0,
  status: 'draft',
  currency: 'QAR',
  clientName: 'Omar',
  clientCompany: null,
  clientPhone: '+97455551234',
  location: 'Doha',
  projectName: 'Entrance',
  subject: 'Pivot doors',
  validUntil: '2026-11-15',
  contactId: null,
  dealId: null,
  assignedTo: null,
  discountType: null,
  discountValue: null,
  subtotal: 0,
  discountAmount: 0,
  total: 0,
  pdfStoragePath: null,
  createdAt: '2026-10-14T10:00:00Z',
  deliveryTerms: 'Within 30 days of approval',
  paymentTerms: 'On acceptance',
  warrantyTerms: 'One year',
  items: [],
};
const id = '33333333-3333-4333-8333-333333333333';
function draft() {
  const d = draftFromQuotation(quote);
  d.items = [
    {
      id,
      itemType: 'line',
      description: 'Pivot door',
      qty: 3,
      unitPrice: 123.45,
      specification: 'Steel',
      sizeW: 900,
      sizeH: 2100,
      measurementUnit: 'mm',
      unit: 'piece',
      descriptionAr: 'باب محوري',
    },
  ];
  return d;
}
describe('quotation workspace', () => {
  it('offers editable defaults only for unset draft terms and preserves saved text', () => {
    const unset = {
      ...quote,
      deliveryTerms: null,
      paymentTerms: null,
      warrantyTerms: null,
    };
    expect(draftFromQuotation(unset).deliveryTerms).toContain(
      'advance payment'
    );
    expect(draftFromQuotation(unset).paymentTerms).toContain(
      'before order acceptance'
    );
    expect(draftFromQuotation(unset, false).deliveryTerms).toBe('');
    expect(draftFromQuotation({ ...unset, status: 'sent' }).paymentTerms).toBe(
      ''
    );
    expect(
      draftFromQuotation({ ...unset, paymentTerms: '' }).paymentTerms
    ).toBe('');
    expect(draftFromQuotation(quote).paymentTerms).toBe('On acceptance');
  });
  it('preserves optional template fields and lets incomplete drafts save', () => {
    expect(validateDraft(draftFromQuotation(quote))).toBeNull();
    const d = draft();
    d.documentDetails = {
      consultant: 'Consultant',
      subjectAr: 'أبواب',
      notes: 'Customer note',
      paymentSchedule: { advance: 50, delivery: 40, completion: 10 },
    };
    expect(validateDraft(d, true)).toBeNull();
    const restored = draftFromQuotation(draftQuotation(quote, d));
    expect(restored.documentDetails).toMatchObject(d.documentDetails);
    expect(restored.items[0]).toMatchObject(d.items[0]);
  });
  it('requires explicit price, validity and commercial terms for export', () => {
    const d = draft();
    d.items[0].unitPrice = undefined;
    expect(validateDraft(d, true)).toBe('priceRequired');
    d.items[0].unitPrice = 0;
    expect(validateDraft(d, true)).toBeNull();
    d.validUntil = '';
    expect(validateDraft(d, true)).toBe('validityRequired');
    d.validUntil = '2026-11-15';
    d.paymentTerms = '';
    expect(validateDraft(d, true)).toBe('termsRequired');
  });
  it('rejects malformed values, duplicate ids, nested children and excessive discounts', () => {
    const d = draft();
    d.items[0].qty = -1;
    expect(validateDraft(d)).toBe('invalidItem');
    d.items[0].qty = 1;
    d.items[0].unitPrice = NaN;
    expect(validateDraft(d)).toBe('invalidItem');
    d.items[0].unitPrice = 100;
    d.orderDiscount = { discountType: 'fixed', discountValue: 101 };
    expect(validateDraft(d)).toBe('invalidDiscount');
    d.orderDiscount = undefined;
    d.items.push({ ...d.items[0] });
    expect(validateDraft(d)).toBe('invalidItem');
  });
  it('rejects invalid stage totals and calendar dates', () => {
    const d = draft();
    d.documentDetails.paymentSchedule = {
      advance: 50,
      delivery: 40,
      completion: 9,
    };
    expect(validateDraft(d, true)).toBe('invalidSchedule');
    d.documentDetails.paymentSchedule = undefined;
    d.validUntil = '2026-02-30';
    expect(validateDraft(d)).toBe('invalidDraft');
  });
  it('renders actual bilingual template fields and escapes customer text', () => {
    const d = draft();
    d.documentDetails = {
      consultant: 'A & B',
      subjectAr: 'الأبواب',
      included: 'Installation <script>bad</script>',
      excluded: 'Civil works',
      notes: 'Customer note $&',
      preparedBy: 'Nader',
      repPhone: '+97450000000',
      shopDrawingDays: 5,
      paymentSchedule: { advance: 50, delivery: 40, completion: 10 },
    };
    d.orderDiscount = { discountType: 'fixed', discountValue: 20 };
    const q = draftQuotation(quote, d);
    const html = buildQuotationHtml(q, q.items);
    expect(html).toContain('A &amp; B');
    expect(html).toContain('باب محوري');
    expect(html).toContain('900 × 2100 mm');
    expect(html).toContain('Customer note $&');
    expect(html).toContain('50 %');
    expect(html).toContain('Steel');
    expect(html).toContain('Within 30 days of approval');
    expect(html).toContain('Prepared by Nader');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Discount · الخصم: −20');
  });
  it('keeps children next to parents regardless of insertion order', () => {
    const d = draft();
    d.items.push({
      id: '44444444-4444-4444-8444-444444444444',
      itemType: 'line',
      description: 'Second door',
      qty: 1,
      unitPrice: 10,
    });
    d.items.push({
      id: '55555555-5555-4555-8555-555555555555',
      itemType: 'line',
      parentItemId: id,
      description: 'Handle',
      qty: 1,
      unitPrice: 1,
    });
    const q = draftQuotation(quote, d);
    const html = buildQuotationHtml(q, q.items);
    expect(html.indexOf('Handle')).toBeLessThan(html.indexOf('Second door'));
  });
  it('rounds monetary amounts to two decimals consistently', () => {
    const d = draft();
    d.items[0].qty = 3;
    d.items[0].unitPrice = 0.1;
    expect(draftQuotation(quote, d).total).toBe(0.3);
  });
});

describe('CRM quotation context', () => {
  const deal = {
    id: 'deal-a',
    title: 'Private villa – Lusail',
    contact_id: 'contact-a',
  };
  const contact = {
    id: 'contact-a',
    name: 'Customer',
    phone: '+97455550000',
    company: 'Customer Co',
  };
  it('fills empty document fields from the linked deal and WhatsApp contact', () => {
    const d = {
      ...draft(),
      dealId: deal.id,
      projectName: '',
      clientName: '',
      clientPhone: '',
      clientCompany: '',
    };
    expect(fillQuotationContext(d, deal, contact)).toMatchObject({
      projectName: deal.title,
      clientName: contact.name,
      clientPhone: contact.phone,
      clientCompany: contact.company,
      contactId: contact.id,
    });
  });
  it('preserves user edits and rejects a stale deal response', () => {
    const d = {
      ...draft(),
      dealId: deal.id,
      clientName: 'Edited name',
      clientPhone: '+97411111111',
    };
    expect(fillQuotationContext(d, deal, contact)).toMatchObject({
      clientName: d.clientName,
      clientPhone: d.clientPhone,
      projectName: d.projectName,
    });
    expect(
      fillQuotationContext({ ...d, dealId: 'other' }, deal, contact).clientName
    ).toBe(d.clientName);
  });
  it('does not mix contact details when another customer is linked', () => {
    const d = {
      ...draft(),
      dealId: deal.id,
      contactId: 'other-contact',
      clientPhone: '',
    };
    expect(fillQuotationContext(d, deal, contact).clientPhone).toBe('');
  });
});

describe('area-priced document validation and output', () => {
  it('allows partial area dimensions in a draft, but requires them for export', () => {
    const d = draft();
    d.items[0] = {
      ...d.items[0],
      unit: 'm2',
      sizeW: undefined,
      sizeH: undefined,
    };
    expect(validateDraft(d)).toBe(null);
    expect(validateDraft(d, true)).toBe('areaDimensionsRequired');
  });
  it('validates discounts against area-priced amounts and renders the formula', () => {
    const d = draft();
    d.items[0] = {
      ...d.items[0],
      unit: 'm2',
      measurementUnit: 'm',
      sizeW: 2,
      sizeH: 3,
      qty: 2,
      unitPrice: 100,
      discountType: 'fixed',
      discountValue: 500,
    };
    expect(validateDraft(d)).toBe(null);
    const snapshot = draftQuotation(quote, d);
    expect(snapshot.total).toBe(700);
    const html = buildQuotationHtml(snapshot, snapshot.items);
    expect(html).toContain('6 m² × 2 = 12 m²');
    expect(html).toContain('QAR / m²');
    expect(html).toContain('openings · فتحات');
    d.items[0].measurementUnit = 'inch';
    expect(validateDraft(d)).toBe('invalidItem');
  });
});
