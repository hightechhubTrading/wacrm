import { describe, expect, it } from 'vitest';
import {
  approvedCatalogRows,
  parseCatalogMetadata,
  catalogPriceError,
} from './catalog';
import { parseKnowledgeMetadata } from './knowledge-metadata';
import { shutterClarification } from './recovery';
import type { SalesEvidence } from './typesafe/sales';

describe('catalog review boundaries', () => {
  it('hides drafts, descendants of drafts, orphaned rows and cycles', () => {
    const rows = [
      { id: 'family', status: 'draft' },
      { id: 'child', parent_id: 'family', status: 'approved' },
      { id: 'good', status: 'approved' },
      { id: 'orphan', parent_id: 'missing', status: 'approved' },
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ];
    expect(approvedCatalogRows(rows).map((r) => r.id)).toEqual(['good']);
  });
  it('requires a complete range and unit on the exact product', () => {
    expect(
      catalogPriceError({
        price_min: 350,
        price_max: 380,
        price_unit: 'per_square_meter',
      })
    ).toBeNull();
    for (const row of [
      { price_min: 350 },
      { price_min: -1, price_max: 380, price_unit: 'per_item' },
      { price_min: 350, price_max: 380 },
      {
        kind: 'family',
        price_min: 350,
        price_max: 380,
        price_unit: 'per_item',
      },
    ])
      expect(catalogPriceError(row)).not.toBeNull();
  });
  it('rejects script URLs, malformed parents and invalid review states', () => {
    expect(() =>
      parseCatalogMetadata({ source_url: 'javascript:alert(1)' })
    ).toThrow();
    expect(() => parseCatalogMetadata({ parent_id: 'foreign' })).toThrow();
    expect(() => parseCatalogMetadata({ status: 'published' })).toThrow();
    expect(() => parseKnowledgeMetadata({ product_id: 'foreign' })).toThrow();
    expect(() =>
      parseKnowledgeMetadata({ source_url: 'data:text/html,hello' })
    ).toThrow();
  });
});

const evidence = (messages: SalesEvidence['messages']): SalesEvidence => ({
  messages,
  products: [],
  knowledge: [],
  collectFields: [],
  businessContext: null,
});
it('offers a narrow clarification for the audited Shatar question', () => {
  expect(
    shutterClarification(
      evidence([
        {
          role: 'user',
          content:
            'مرحبًا، شاهدت إعلان أبواب الشتر الأوتوماتيكية وأريد مزيدًا من التفاصيل.',
        },
        {
          role: 'assistant',
          content:
            'We supply automatic shutter doors for garages and shops. What dimensions?',
        },
        {
          role: 'user',
          content: 'How much money do you meter for the work of Shatar?',
        },
      ])
    )
  ).toContain('window shutters');
});
it('does not repeat a product distinction already answered or asked', () => {
  expect(
    shutterClarification(
      evidence([{ role: 'user', content: 'Window shutter price?' }])
    )
  ).toBeNull();
  expect(
    shutterClarification(
      evidence([
        { role: 'assistant', content: 'Window shutters or garage shutters?' },
        { role: 'user', content: 'Shutter meter price?' },
      ])
    )
  ).toBeNull();
});
