import { describe, expect, it } from 'vitest';
import { computeQuotationTotals, type QuotationItemInput } from './totals';

describe('computeQuotationTotals', () => {
  it('sums flat line items with no discount', () => {
    const items: QuotationItemInput[] = [
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 2400 },
      { id: 'b', itemType: 'line', qty: 2, unitPrice: 500 },
    ];
    const result = computeQuotationTotals(items);
    expect(result.subtotal).toBe(3400);
    expect(result.total).toBe(3400);
    expect(result.itemTotals.a).toBe(2400);
    expect(result.itemTotals.b).toBe(1000);
  });

  it('ignores section headers entirely', () => {
    const items: QuotationItemInput[] = [
      { id: 's', itemType: 'section' },
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 100 },
    ];
    expect(computeQuotationTotals(items).subtotal).toBe(100);
  });

  it('applies a fixed discount to a single line item', () => {
    const items: QuotationItemInput[] = [
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 1000, discountType: 'fixed', discountValue: 150 },
    ];
    const result = computeQuotationTotals(items);
    expect(result.itemTotals.a).toBe(850);
    expect(result.subtotal).toBe(850);
  });

  it('applies a percent discount to a single line item', () => {
    const items: QuotationItemInput[] = [
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 2000, discountType: 'percent', discountValue: 10 },
    ];
    expect(computeQuotationTotals(items).itemTotals.a).toBe(1800);
  });

  it('includes accessory/customization sub-items under a parent product', () => {
    const items: QuotationItemInput[] = [
      { id: 'door', itemType: 'line', qty: 1, unitPrice: 16000 },
      { id: 'lock', itemType: 'line', parentItemId: 'door', kind: 'Accessory', qty: 1, unitPrice: 3000 },
      { id: 'handle', itemType: 'line', parentItemId: 'door', kind: 'Customization', qty: 1, unitPrice: 800 },
    ];
    const result = computeQuotationTotals(items);
    expect(result.subtotal).toBe(19800);
    expect(result.itemTotals.door).toBe(16000);
    expect(result.itemTotals.lock).toBe(3000);
    expect(result.itemTotals.handle).toBe(800);
  });

  it('applies an order-level fixed discount after subtotal', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line', qty: 1, unitPrice: 3600 }];
    const result = computeQuotationTotals(items, { discountType: 'fixed', discountValue: 600 });
    expect(result.subtotal).toBe(3600);
    expect(result.discountAmount).toBe(600);
    expect(result.total).toBe(3000);
  });

  it('applies an order-level percent discount after subtotal', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line', qty: 1, unitPrice: 10000 }];
    const result = computeQuotationTotals(items, { discountType: 'percent', discountValue: 15 });
    expect(result.discountAmount).toBe(1500);
    expect(result.total).toBe(8500);
  });

  it('never lets a total go negative', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line', qty: 1, unitPrice: 100 }];
    const result = computeQuotationTotals(items, { discountType: 'fixed', discountValue: 500 });
    expect(result.total).toBe(0);
  });

  it('treats a missing qty as 1 and a missing unitPrice as 0', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line' }];
    expect(computeQuotationTotals(items).subtotal).toBe(0);
  });
});
