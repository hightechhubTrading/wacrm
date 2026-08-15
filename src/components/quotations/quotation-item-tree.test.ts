import { describe, expect, it } from 'vitest';
import { toItemToSave } from './quotation-item-tree';
import type { QuotationItem } from '@/lib/quotations/types';

// Locks in the fix made in Task 13's review: toItemToSave is a
// hand-written field-by-field mapper between the GET/PATCH wire shape
// (QuotationItem, via mapQuotationItemRow — nulls for absent optional
// fields) and the tree editor's state shape (QuotationItemToSave —
// undefined for absent optional fields). This is the same bug class the
// codebase has already hit twice: Task 5's original bug, and Task 12's
// toPatchPayload fix (quotation-form.test.ts). tsc/eslint can't catch a
// value-level mistake here (e.g. a swapped sizeW/sizeH) since every
// field on QuotationItemToSave is optional and both fields are `number`
// — structurally compatible either way. Only a value-asserting test
// catches that.
describe('toItemToSave', () => {
  const fixture: QuotationItem = {
    id: '11111111-1111-4111-8111-111111111111',
    quotationId: '22222222-2222-4222-8222-222222222222',
    parentItemId: '33333333-3333-4333-8333-333333333333',
    productId: '44444444-4444-4444-8444-444444444444',
    position: 0,
    itemType: 'line',
    kind: 'Accessory',
    itemCode: 'SKU-001',
    description: 'Sliding door track',
    descriptionAr: 'مسار باب منزلق',
    sizeW: 3.66,
    sizeH: 2.6,
    qty: 2,
    unitPrice: 450,
    discountType: 'percent',
    discountValue: 10,
    lineTotal: 810,
  };

  it('maps every field to the QuotationItemToSave shape', () => {
    const result = toItemToSave(fixture);

    expect(result).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      itemType: 'line',
      parentItemId: '33333333-3333-4333-8333-333333333333',
      kind: 'Accessory',
      qty: 2,
      unitPrice: 450,
      discountType: 'percent',
      discountValue: 10,
      productId: '44444444-4444-4444-8444-444444444444',
      itemCode: 'SKU-001',
      description: 'Sliding door track',
      descriptionAr: 'مسار باب منزلق',
      sizeW: 3.66,
      sizeH: 2.6,
    });
  });

  it('does not swap sizeW and sizeH', () => {
    // Deliberately distinct values so a swap is observable rather than
    // silently passing on symmetric fixture data.
    const result = toItemToSave({ ...fixture, sizeW: 3.66, sizeH: 2.6 });

    expect(result.sizeW).toBe(3.66);
    expect(result.sizeH).toBe(2.6);
  });

  it('maps a null parentItemId to undefined (top-level item)', () => {
    const result = toItemToSave({ ...fixture, parentItemId: null });

    expect(result.parentItemId).toBeUndefined();
  });

  it('maps null discountType/discountValue to undefined (no discount set)', () => {
    const result = toItemToSave({ ...fixture, discountType: null, discountValue: null });

    expect(result.discountType).toBeUndefined();
    expect(result.discountValue).toBeUndefined();
  });

  it('maps every other nullable field to undefined, not null', () => {
    const result = toItemToSave({
      ...fixture,
      parentItemId: null,
      productId: null,
      kind: null,
      itemCode: null,
      description: null,
      descriptionAr: null,
      sizeW: null,
      sizeH: null,
      qty: null,
      unitPrice: null,
      discountType: null,
      discountValue: null,
    });

    expect(result).toEqual({
      id: fixture.id,
      itemType: 'line',
    });
    // Explicitly not null anywhere -- QuotationItemToSave's fields are
    // all typed as optional `T | undefined`, never `T | null`.
    for (const value of Object.values(result)) {
      expect(value).not.toBeNull();
    }
  });

  it('carries a section item straight through (itemType survives)', () => {
    const result = toItemToSave({ ...fixture, itemType: 'section', parentItemId: null });

    expect(result.itemType).toBe('section');
  });
});
