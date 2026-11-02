import { describe, it, expect } from 'vitest';
import {
  normalizedItemName,
  normalizedScreenName,
  normalizedQuantityUnit,
  sourceDisplayValue,
  recordDisplayLabel,
  sourceReadyToApply,
} from './normalization';
import { snapshot, calculatePrice, landedUnitCost } from './calculations';
import type { KnowledgeRecord } from './types';
const record: KnowledgeRecord = {
  id: 'r',
  batch_id: 'b',
  record_key: 'source:1',
  kind: 'price',
  source: 'source.csv',
  source_row: 1,
  data: { item_en: 'Tube motor 44 mm, 40 kg', col_O: '650', col_P: '600' },
  review_status: 'approved',
  review_version: 1,
  reviewed_at: '2026-11-02T00:00:00Z',
  review_notes: null,
  configuration: {},
};
describe('company record normalization', () => {
  it('normalizes count units without guessing purchasing-length conversions', () => {
    expect(normalizedQuantityUnit('per motor')).toBe('piece');
    expect(normalizedQuantityUnit('per m')).toBe('m');
    expect(normalizedQuantityUnit('6M')).toBe('6M');
    expect(normalizedQuantityUnit('1-6M')).toBe('1-6M');
    expect(normalizedQuantityUnit('')).toBeNull();
  });
  it('preserves literal file paths and identifiers in the cleaned view', () => {
    expect(
      sourceDisplayValue('source_file', 'Company Qutations/REF-01.pdf')
    ).toBe('Company Qutations/REF-01.pdf');
    expect(sourceDisplayValue('source_code_or_size', 'CR NO 250')).toBe(
      'CR NO 250'
    );
  });
  it('uses the explicit fabric to correct a conflicting supplier screen title', () => {
    expect(
      normalizedScreenName(
        'Electroll 103 STRONG FLYSCREEN SUNSCREEN COPACO MESH / MOSEL MOTOR'
      )
    ).toBe('Electroll 103 · Copaco Sunscreen · Mosel');
  });
  it('replaces bilingual extraction fragments with a readable name while retaining the supplier code and dimensions', () => {
    expect(
      normalizedItemName(
        'BB.60-100: lık Borubaşı 10 mm Pimli 60 mm TUBE CAP WITH 10mm PIN'
      )
    ).toBe('Tube cap with 10 mm pin, 60 mm — BB.60-100');
    expect(normalizedItemName('TP.55-200: mm M-SHAPED SIDE LOCK')).toBe(
      'M-shaped side lock — TP.55-200'
    );
  });
  it('improves display text without changing original values or immutable snapshot labels', () => {
    const before = JSON.stringify(record);
    expect(recordDisplayLabel(record)).toBe('Tubular motor 44 mm, 40 kg');
    expect(snapshot(record).label).toBe('Tube motor 44 mm, 40 kg');
    expect(JSON.stringify(record)).toBe(before);
  });
  it('accepts documented evidence independently of whether price/cost calculations have been set up', () => {
    expect(sourceReadyToApply(record)).toBe(false);
    expect(() =>
      calculatePrice(record, { id: 'i', itemType: 'line', qty: 1 })
    ).toThrow(/rule/);
    expect(() => landedUnitCost({ ...record, kind: 'supplier' })).toThrow(
      /currency/
    );
    expect(
      sourceReadyToApply({
        ...record,
        configuration: {
          pricing: { basis: 'piece', rate: 650, currency: 'QAR' },
        },
      })
    ).toBe(true);
  });
});
