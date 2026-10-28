import { describe, it, expect } from 'vitest';
import {
  EMPTY_GUIDE,
  parseGuideSections,
  renderGuideContent,
  nearestCustomerGuide,
  guideProductChain,
  type CustomerGuide,
} from './customer-guides';
import {
  customerGuideDrafts,
  CUSTOMER_GUIDE_TEMPLATES,
} from './customer-guide-templates';
const sections = {
  explanation: 'Simple explanation',
  options: 'Choices',
  selection: 'Needs',
  next_question: 'Preference?',
  faq: 'FAQ',
};
describe('customer guides', () => {
  it('requires valid structured fields and complete review before approval', () => {
    expect(
      parseGuideSections({ ...EMPTY_GUIDE, explanation: '  Description  ' })
    ).toEqual({ ...EMPTY_GUIDE, explanation: 'Description' });
    for (const value of [
      null,
      [],
      { ...sections, options: 42 },
      { ...sections, faq: 'x'.repeat(6001) },
      { ...sections, price: 500 },
    ])
      expect(() => parseGuideSections(value)).toThrow();
    expect(() =>
      parseGuideSections({ ...EMPTY_GUIDE, explanation: 'Description' }, true)
    ).toThrow();
    expect(parseGuideSections(sections, true)).toEqual(sections);
  });
  it('labels derived knowledge as education without company commitments', () => {
    const content = renderGuideContent(sections);
    expect(content).toContain('does not establish company availability');
    expect(content).toContain('## Compare options\nChoices');
  });
  it('reuses one family guide for siblings and selects an exact override first', () => {
    const products = [
      { id: 'f', name: 'Family', parent_id: null, kind: 'family' },
      { id: 'p', name: 'Product', parent_id: 'f', kind: 'product' },
      { id: 'v', name: 'Variant', parent_id: 'p', kind: 'variant' },
      { id: 'other', name: 'Other', parent_id: 'f', kind: 'product' },
    ];
    const shared = { id: 'guide', product_id: 'f' } as CustomerGuide;
    expect(nearestCustomerGuide(products, 'v', [shared])).toBe(shared);
    expect(nearestCustomerGuide(products, 'other', [shared])).toBe(shared);
    const specific = { id: 'exact', product_id: 'p' } as CustomerGuide;
    expect(nearestCustomerGuide(products, 'v', [shared, specific])).toBe(
      specific
    );
  });
  it('hides guides on missing, cyclic and historical branches', () => {
    for (const rows of [
      [{ id: 'v', name: 'Orphan', kind: 'variant', parent_id: 'missing' }],
      [{ id: 'p', name: 'Cycle', kind: 'product', parent_id: 'p' }],
      [
        {
          id: 'f',
          name: 'Old',
          kind: 'family',
          parent_id: null,
          superseded_by: 'new',
        },
        { id: 'v', name: 'Child', kind: 'product', parent_id: 'f' },
      ],
    ])
      expect(guideProductChain(rows, rows.at(-1)!.id)).toEqual([]);
  });
  it('prepares one complete bilingual draft for each known family, never fuzzy-matching an unknown family', () => {
    const families = CUSTOMER_GUIDE_TEMPLATES.map((t, i) => ({
      id: String(i),
      name: t.names[0],
      kind: 'family',
      parent_id: null,
    }));
    const drafts = customerGuideDrafts([
      ...families,
      { id: 'unknown', name: 'Unknown doors', kind: 'family', parent_id: null },
      { ...families[0], id: 'history', superseded_by: 'new' },
    ]);
    expect(drafts).toHaveLength(10);
    for (const d of drafts) {
      expect(parseGuideSections(d.guide_sections, true)).toEqual(
        d.guide_sections
      );
      for (const text of Object.values(d.guide_sections))
        expect(text).toMatch(/[\u0600-\u06ff]/);
      expect(d).not.toHaveProperty('status');
    }
  });
});
