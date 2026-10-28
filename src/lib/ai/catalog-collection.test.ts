import { describe, it, expect } from 'vitest';
import { parseCatalogQuestion, catalogGaps } from './catalog-collection';
describe('collection boundaries', () => {
  it('only accepts collection fields, without publishing answers', () => {
    expect(
      parseCatalogQuestion({
        question: ' Warranty? ',
        answer: ' one year ',
        status: 'answered',
        account_id: 'other',
        approved: true,
      })
    ).toEqual({
      question: 'Warranty?',
      answer: 'one year',
      status: 'answered',
    });
  });
  it('rejects invalid dates, links and invented statuses', () => {
    for (const value of [
      { confirmed_on: '2026-02-30' },
      { product_id: 'other-account' },
      { status: 'approved' },
      { question: ' ' },
      { answer: 'x'.repeat(12001) },
    ])
      expect(() => parseCatalogQuestion(value)).toThrow();
  });
  it('does not classify family pricing or zero-valued estimates as gaps', () => {
    expect(
      catalogGaps({
        kind: 'family',
        price_min: null,
        price_max: null,
        price_unit: null,
      })
    ).toEqual([]);
    expect(
      catalogGaps({
        kind: 'product',
        price_min: 0,
        price_max: 0,
        price_unit: 'per_item',
        specifications: 'Approved facts',
        files: [{}],
      })
    ).toEqual([]);
  });
});
