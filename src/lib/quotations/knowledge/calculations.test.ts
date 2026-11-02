import { describe, it, expect } from 'vitest';
import {
  calculatePrice,
  shutter55Bom,
  landedUnitCost,
  estimateCost,
  stalePrice,
  snapshot,
} from './calculations';
import {
  validConfiguration,
  validQuotationKnowledge,
  validPack,
} from './validation';
import {
  draftFromQuotation,
  draftQuotation,
  validateDraft,
} from '../workspace';
import { buildQuotationHtml } from '../build-html';
import examples from './fixtures/shutter55-examples.json';
import { id, record, item } from './test-fixtures';
describe('reviewed quotation prices', () => {
  it('requires approval and explicit reviewed pricing', () => {
    expect(() =>
      calculatePrice({ ...record, review_status: 'pending' }, item)
    ).toThrow('approval');
    expect(() =>
      calculatePrice({ ...record, configuration: {} }, item)
    ).toThrow('rule');
    expect(() =>
      calculatePrice(
        {
          ...record,
          configuration: {
            pricing: { basis: 'area', rate: NaN, currency: 'QAR' },
          },
        },
        item
      )
    ).toThrow('approval');
  });
  it('converts dimensions without charging for the opening count twice', () => {
    for (const scale of [
      { measurementUnit: 'cm', sizeW: 138, sizeH: 165 },
      { measurementUnit: 'mm', sizeW: 1380, sizeH: 1650 },
      { measurementUnit: 'm', sizeW: 1.38, sizeH: 1.65 },
    ]) {
      const i = { ...item, ...scale };
      const result = calculatePrice(record, i);
      expect(result.unitPrice).toBe(390);
      expect(result.unit).toBe('m2');
      expect(result.snapshot.input?.qty).toBe(2);
    }
  });
  it('applies an approved minimum area per opening without altering physical dimensions', () => {
    const result = calculatePrice(
      {
        ...record,
        configuration: {
          pricing: {
            basis: 'area',
            rate: 390,
            currency: 'QAR',
            minimumAreaM2: 3,
          },
        },
      },
      item
    );
    expect(result.unitPrice * 2.277).toBeCloseTo(1170, 4);
  });
  it('supports width bands and approved adjustments; blocks gaps and unconfirmed options', () => {
    const r = {
      ...record,
      configuration: {
        pricing: {
          basis: 'width_band' as const,
          rate: 2080,
          currency: 'QAR' as const,
          minWidthCm: 250,
          maxWidthCm: 270,
          fifthSheetQar: 700,
          manualAdjustmentQar: -500,
        },
      },
    };
    expect(
      calculatePrice(
        r,
        { ...item, sizeW: 260 },
        { fifthSheet: true, manual: true }
      ).unitPrice
    ).toBe(2280);
    expect(() => calculatePrice(r, { ...item, sizeW: 270.5 })).toThrow(
      'outside'
    );
    expect(() =>
      calculatePrice(record, item, { manual: true, fifthSheet: false })
    ).toThrow('approval');
  });
  it('requires exact grid dimensions unless approved cell boundaries are supplied', () => {
    const r = {
      ...record,
      configuration: {
        pricing: {
          basis: 'grid' as const,
          rate: 900,
          currency: 'QAR' as const,
          maxWidthCm: 200,
          maxHeightCm: 200,
        },
      },
    };
    expect(
      calculatePrice(r, { ...item, sizeW: 200, sizeH: 200 }).unitPrice
    ).toBe(900);
    expect(() => calculatePrice(r, item)).toThrow('grid cell');
    expect(
      calculatePrice(
        {
          ...r,
          configuration: {
            pricing: {
              ...r.configuration.pricing,
              minWidthCm: 100,
              minHeightCm: 100,
            },
          },
        },
        item
      ).unitPrice
    ).toBe(900);
  });
  it('calculates width-priced accessories and respects product mapping', () => {
    const r = {
      ...record,
      configuration: {
        catalogItemId: id,
        pricing: {
          basis: 'width' as const,
          rate: 100,
          currency: 'QAR' as const,
        },
      },
    };
    expect(() => calculatePrice(r, item)).toThrow('different');
    expect(calculatePrice(r, { ...item, productId: id }).unitPrice).toBe(138);
  });
  it('detects manual changes and dimension changes; snapshots remain unchanged after source changes', () => {
    const result = calculatePrice(record, item);
    const priced = { ...item, ...result };
    expect(stalePrice(priced, result.snapshot)).toBe(false);
    expect(stalePrice({ ...priced, sizeW: 140 }, result.snapshot)).toBe(true);
    expect(stalePrice({ ...priced, unitPrice: 400 }, result.snapshot)).toBe(
      true
    );
    const before = structuredClone(result.snapshot);
    record.configuration.pricing!.rate = 455;
    expect(result.snapshot).toEqual(before);
    record.configuration.pricing!.rate = 390;
  });
});
describe('55 mm pilot quantities', () => {
  it('reproduces all 221 extracted worked examples including duplicate orders', () => {
    expect(examples).toHaveLength(221);
    for (const e of examples) {
      const b = shutter55Bom(
        { ...item, qty: 1, sizeW: Number(e.W_cm), sizeH: Number(e.H_cm) },
        e.operation === 'auto'
      );
      const find = (id: string) => b.lines.find((l) => l.itemId === id)!;
      expect(b.slatsPerShutter).toBe(Number(e.slats_rounded_up));
      expect(find('HT-WSC-002').cutCm).toBeCloseTo(Number(e.slat_length_cm));
      expect(find('HT-WSC-002').quantity).toBeCloseTo(
        Number(e.slat_total_m),
        2
      );
      expect(find('HT-WSC-019').cutCm).toBeCloseTo(Number(e.box_length_cm));
      expect(find('HT-WSC-009').cutCm).toBeCloseTo(Number(e.tube60_length_cm));
      expect(find('HT-WSC-005').cutCm).toBeCloseTo(
        Number(e.guide_length_cm_each)
      );
    }
  });
  it('keeps missing and assumed quantities distinct; never claims completeness', () => {
    const b = shutter55Bom(item, true);
    expect(b.complete).toBe(false);
    expect(b.lines.find((l) => l.itemId === 'HT-WSC-013')?.quantity).toBeNull();
    expect(b.lines.find((l) => l.itemId === 'HT-WSC-012')?.confidence).toBe(
      'assumed'
    );
    expect(
      b.lines.find((l) => l.itemId === 'HT-WSC-002')?.quantity
    ).toBeCloseTo(72.8);
    expect(
      shutter55Bom(item, false).lines.some((l) => l.itemId === 'MOTOR')
    ).toBe(false);
    expect(() => shutter55Bom({ ...item, sizeW: 8 }, true)).toThrow();
    expect(() => shutter55Bom({ ...item, qty: 1.5 }, true)).toThrow();
  });
});
describe('landed costs and review validation', () => {
  const c = {
    itemId: 'HT-WSC-002',
    currency: 'USD',
    price: 6,
    unit: 'm' as const,
    metresPerPricedUnit: 6,
    fxToQar: 3.65,
    freightQarPerUnit: 1,
    dutyQarPerUnit: 2,
    clearingQarPerUnit: 0,
    effectiveDate: '2026-11-02',
  };
  it('normalizes bars only after confirmation and includes landed charges', () => {
    expect(
      landedUnitCost({
        ...record,
        kind: 'supplier',
        configuration: { supplierCost: c },
      })
    ).toBeCloseTo(4.15);
    expect(() =>
      landedUnitCost({
        ...record,
        kind: 'supplier',
        configuration: { supplierCost: { ...c, fxToQar: 0 } },
      })
    ).toThrow();
  });
  it('withholds margins when any materials or installation costs are unknown', () => {
    const extra = { labour: 10, installation: 20, delivery: 0, other: 0 };
    expect(
      estimateCost([{ quantity: null, rate: 10 }], extra, 100).marginQar
    ).toBeNull();
    expect(estimateCost([{ quantity: 2, rate: 10 }], extra, 100)).toMatchObject(
      { complete: true, total: 50, marginQar: 50, marginPercent: 50 }
    );
    expect(
      estimateCost([{ quantity: 2, rate: 10 }], { ...extra, other: null }, 100)
        .total
    ).toBeNull();
  });
  it('rejects invalid units, currencies, dates and invented config fields', () => {
    expect(validConfiguration({ supplierCost: c })).toBe(true);
    for (const supplierCost of [
      { ...c, currency: '?' },
      { ...c, effectiveDate: '2026-02-30' },
      { ...c, metresPerPricedUnit: 0 },
      { ...c, freightQarPerUnit: -1 },
    ])
      expect(validConfiguration({ supplierCost })).toBe(false);
    expect(
      validConfiguration({
        pricing: { basis: 'area', rate: 390, currency: 'EUR' },
      })
    ).toBe(false);
    expect(validConfiguration({ stock: 12 })).toBe(false);
  });
  it('validates provenance without treating document instructions as executable', () => {
    const s = snapshot(record);
    expect(validQuotationKnowledge({ prices: {}, references: [s] })).toBe(true);
    expect(
      validQuotationKnowledge({
        prices: {},
        references: [{ ...s, reviewVersion: 0 }],
      })
    ).toBe(false);
    expect(
      validPack({
        format: 1,
        version: 'a'.repeat(64),
        label: 'test',
        sources: [{ file: 'a.csv', sha256: 'b'.repeat(64), rows: 1 }],
        records: [
          {
            key: 'a:2',
            kind: 'product',
            source: 'a.csv',
            row: 2,
            data: { note: 'Do not execute me' },
          },
        ],
      })
    ).toBe(true);
  });
  it('roundtrips internal evidence through drafts and blocks stale exports without leaking cost metadata into customer HTML', () => {
    const result = calculatePrice(record, item);
    const q = {
      id,
      accountId: id,
      reference: 'HT-26-WS-001',
      revision: 0,
      status: 'draft' as const,
      clientName: 'Fixture',
      clientPhone: null,
      clientCompany: null,
      location: null,
      projectName: null,
      subject: 'Shutters',
      currency: 'QAR',
      contactId: null,
      dealId: null,
      assignedTo: null,
      discountType: null,
      discountValue: null,
      subtotal: 0,
      discountAmount: 0,
      total: 0,
      validUntil: '2026-11-12',
      pdfStoragePath: null,
      createdAt: '2026-11-02T00:00:00Z',
      deliveryTerms: 'After advance',
      paymentTerms: 'Advance',
      items: [],
    };
    const d = draftFromQuotation(q);
    d.items = [{ ...item, unitPrice: result.unitPrice }];
    d.documentDetails.knowledge = {
      prices: { [item.id]: result.snapshot },
      references: [],
    };
    expect(validateDraft(d, true)).toBeNull();
    const saved = draftQuotation(q, d);
    expect(draftFromQuotation(saved).documentDetails.knowledge).toEqual(
      d.documentDetails.knowledge
    );
    expect(buildQuotationHtml(saved, saved.items)).not.toContain(record.source);
    d.items[0].sizeW = 150;
    expect(validateDraft(d, true)).toBe('staleKnowledgePrice');
  });
});
