import { describe, it, expect } from 'vitest';
import {
  catalogueItem,
  catalogueTerms,
  cataloguePaymentOptions,
  parseCatalogueSelection,
  applyCatalogueCapture,
  type CatalogueProduct,
} from './catalogue';
import { draftFromQuotation, validateDraft } from './workspace';
import { computeQuotationTotals } from './totals';
import { specificationPresetsForItem } from './company-presets';
import type { QuotationWithItems } from './workspace';
const id = '11111111-1111-4111-8111-111111111111',
  sourceId = '22222222-2222-4222-8222-222222222222';
const product: CatalogueProduct = {
  id,
  name: 'Aluminium Window Shutter',
  name_ar: 'شتر نوافذ',
  description: 'External aluminium shutter.',
  specifications: 'White or beige.',
  parent_id: null,
  kind: 'product',
  inventory_type: 'product',
  sku: 'WS',
  unit_of_measure: 'm2',
  price_min: 350,
  price_max: 380,
  price_unit: 'per_square_meter',
  customer_visible: true,
  aliases: [],
  sources: [
    {
      id: sourceId,
      batch_id: id,
      record_key: 'price:45',
      kind: 'price',
      source: 'price.csv',
      source_row: 45,
      data: {
        item_en: 'RC41/55 installed',
        unit: 'per m2',
        col_O: '390',
        col_P: '350',
      },
      review_status: 'approved',
      review_version: 1,
      reviewed_at: '2026-11-02T10:00:00Z',
      review_notes: null,
      configuration: {},
    },
    {
      id: 'terms',
      batch_id: id,
      record_key: 'products:2',
      kind: 'product',
      source: 'products.csv',
      source_row: 2,
      data: {
        standard_delivery: '10-20 days',
        standard_payment: '100% advance (villa) or 70/30 or 60/40',
        warranty: '1 year',
      },
      review_status: 'approved',
      review_version: 1,
      reviewed_at: '2026-11-02T10:00:00Z',
      review_notes: null,
      configuration: {},
    },
  ],
};
const quote = {
  id,
  accountId: id,
  reference: 'HT-26-WS-001',
  revision: 0,
  status: 'draft',
  currency: 'QAR',
  clientName: 'Example',
  clientPhone: null,
  clientCompany: null,
  location: null,
  projectName: null,
  subject: null,
  validUntil: null,
  contactId: null,
  dealId: null,
  assignedTo: null,
  discountType: null,
  discountValue: null,
  subtotal: 0,
  discountAmount: 0,
  total: 0,
  pdfStoragePath: null,
  createdAt: '2026-11-02T10:00:00Z',
  items: [],
} satisfies QuotationWithItems;
describe('catalogue quotation creation', () => {
  it('loads exact specifications and units without choosing the minimum of an estimate', () => {
    const { item } = catalogueItem(product, id, 'D01');
    expect(item.productId).toBe(id);
    expect(item.specification).toBe('White or beige.');
    expect(item.unit).toBe('m2');
    expect(item.unitPrice).toBeUndefined();
    expect(specificationPresetsForItem(item)).toEqual([]);
  });
  it('captures a chosen recorded column as a quotation-specific decision and charges area once', () => {
    const { item, knowledge } = catalogueItem(product, id, 'D01', {
      recordId: sourceId,
      column: 'O',
    });
    expect(item.unitPrice).toBe(390);
    expect(knowledge?.manualOverrides?.[0].reason).toContain('column O');
    expect(knowledge?.references[0].configuration).toEqual({});
    expect(
      computeQuotationTotals([{ ...item, sizeW: 138, sizeH: 165, qty: 2 }])
        .total
    ).toBe(1776.06);
  });
  it('rejects an unrelated source and does not infer exchange rates', () => {
    expect(() =>
      catalogueItem(product, id, 'D01', { recordId: id, column: 'O' })
    ).toThrow('linked');
    expect(() =>
      catalogueItem(
        product,
        id,
        'D01',
        { recordId: sourceId, column: 'O' },
        'USD'
      )
    ).toThrow('QAR');
    expect(
      catalogueItem(
        { ...product, price_min: 3600, price_max: 3600 },
        id,
        'D01',
        undefined,
        'USD'
      ).item.unitPrice
    ).toBeUndefined();
  });
  it('offers documented payment choices and keeps unspecified milestones explicit', () => {
    expect(cataloguePaymentOptions('60/30/10 (or 60/40)')).toHaveLength(2);
    expect(catalogueTerms(product).paymentTerms).toBe('');
    expect(catalogueTerms(product, 0).paymentTerms).toBe(
      '100% advance payment.'
    );
    expect(catalogueTerms(product).warrantyTerms).toBe('Warranty: 1 year.');
    expect(catalogueTerms({ ...product, sources: [] })).toEqual({
      deliveryTerms: '',
      paymentTerms: '',
      warrantyTerms: '',
    });
  });
  it('hydrates a persisted creation seed once and never replaces saved or issued item snapshots', () => {
    const seed = catalogueItem(product, id, 'D01');
    const fresh = draftFromQuotation({
      ...quote,
      documentDetails: { catalogueSeed: seed },
    });
    expect(fresh.items).toHaveLength(1);
    expect(fresh.documentDetails).not.toHaveProperty('catalogueSeed');
    expect(validateDraft(fresh)).toBeNull();
    expect(
      draftFromQuotation(
        { ...quote, status: 'sent', documentDetails: { catalogueSeed: seed } },
        false
      ).items
    ).toEqual([]);
    expect(
      draftFromQuotation(
        {
          ...quote,
          workspaceVersion: 1,
          documentDetails: { catalogueSeed: seed },
        },
        false
      ).items
    ).toEqual([]);
  });
  it('applies catalogue terms without leaving stale source pricing or invalid optional fields', () => {
    const seed = catalogueItem(product, id, 'D01', {
      recordId: sourceId,
      column: 'O',
    });
    const draft = draftFromQuotation(quote);
    draft.items = [seed.item];
    draft.documentDetails = {
      commercialPreset: 'old',
      paymentSchedule: { advance: 60, delivery: 30, completion: 10 },
      knowledge: seed.knowledge,
    };
    const next = applyCatalogueCapture(
      draft,
      undefined,
      catalogueTerms(product, 0),
      id
    );
    expect(next.paymentTerms).toContain('100%');
    expect(next.documentDetails).not.toHaveProperty('commercialPreset');
    expect(next.documentDetails).not.toHaveProperty('paymentSchedule');
    expect(validateDraft(next)).toBeNull();
  });
  it('rejects caller-selected amounts and malformed catalogue identifiers', () => {
    expect(() => parseCatalogueSelection({ productId: 'foreign' })).toThrow();
    expect(() =>
      parseCatalogueSelection({ productId: id, paymentOption: -1 })
    ).toThrow();
    expect(
      parseCatalogueSelection({
        productId: id,
        unitPrice: 1,
        accountId: 'foreign',
      })
    ).not.toHaveProperty('unitPrice');
  });
});
