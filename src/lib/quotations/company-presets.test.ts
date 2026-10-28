import { describe, expect, it } from 'vitest';
import {
  applySpecificationPreset,
  specificationPresetsForItem,
  applyCommercialPreset,
  changeComponentKind,
} from './company-presets';
import { computeQuotationTotals } from './totals';
import {
  draftFromQuotation,
  draftQuotation,
  validateDraft,
  type QuotationWithItems,
} from './workspace';
import { buildQuotationHtml } from './build-html';
import type { QuotationItemToSave } from './crud';
const id = '11111111-1111-4111-8111-111111111111';
const q: QuotationWithItems = {
  id,
  accountId: id,
  reference: 'HT-26-RSD-042',
  revision: 0,
  status: 'draft',
  currency: 'QAR',
  clientName: 'Customer',
  clientCompany: null,
  clientPhone: null,
  location: null,
  projectName: null,
  subject: 'Supply and installation',
  validUntil: '2026-10-29',
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
  deliveryTerms: 'Confirmed delivery',
  paymentTerms: 'Confirmed payment',
  warrantyTerms: 'One year',
  items: [],
};
const product: QuotationItemToSave = {
  id,
  itemType: 'line',
  description: 'Roll-up shutter',
  qty: 1,
  unitPrice: 2400,
  itemCode: 'D01',
};
describe('HTH quotation packages and terms', () => {
  it('prints a full supplied subject once and preserves user text resembling page labels', () => {
    const d = draftFromQuotation(q);
    d.subject = 'Supply and installation OF STEEL doors';
    d.documentDetails.subjectAr = 'توريد وتركيب أبواب حديد';
    d.items = [{ ...product, specification: 'See PAGE 1 OF 2 of the drawing' }];
    const rendered = draftQuotation(q, d);
    const html = buildQuotationHtml(rendered, rendered.items);
    expect(html.includes('Supply and installation of Supply')).toBe(false);
    expect(html.includes('توريد وتركيب توريد')).toBe(false);
    expect(html.includes('See PAGE 1 OF 2 of the drawing')).toBe(true);
  });

  it('matches the steel door and gate package example without charging included controls again', () => {
    const gate = {
      ...product,
      id: crypto.randomUUID(),
      description: 'Swing gate automation',
      unitPrice: 5000,
    };
    const items = applySpecificationPreset(
      [{ ...product, description: 'Steel door', unitPrice: 23400 }, gate],
      gate.id,
      'gateExample'
    );
    expect(computeQuotationTotals(items).total).toBe(28400);
    expect(
      items
        .filter((i) => i.kind === 'Included')
        .find((i) => i.description === 'Remote control')?.qty
    ).toBe(2);
  });

  it('matches the real shutter quotation without double-charging included hardware', () => {
    const items = applySpecificationPreset([product], id, 'shutterExample');
    items.push(
      {
        id: crypto.randomUUID(),
        itemType: 'line',
        parentItemId: id,
        kind: 'Accessory',
        description: 'Box sheet',
        qty: 1,
        unitPrice: 500,
      },
      {
        id: crypto.randomUUID(),
        itemType: 'line',
        parentItemId: id,
        kind: 'Accessory',
        description: 'Side frame',
        qty: 2,
        unitPrice: 150,
      },
      {
        id: crypto.randomUUID(),
        itemType: 'line',
        parentItemId: id,
        kind: 'Accessory',
        description: 'Front decoration',
        qty: 1,
        unitPrice: 400,
      }
    );
    expect(computeQuotationTotals(items).total).toBe(3600);
    const included = items.filter((i) => i.kind === 'Included');
    expect(included).toHaveLength(3);
    expect(included.find((i) => i.description === 'Remote control')?.qty).toBe(
      3
    );
    const d = draftFromQuotation(q);
    d.items = items;
    const preset = applyCommercialPreset(d, 'shutterTerms', '2026-10-14');
    expect(validateDraft(preset, true)).toBeNull();
    const saved = draftQuotation(q, preset);
    const html = buildQuotationHtml(saved, saved.items);
    expect(html).toContain('Included in package');
    expect(html).toContain('100 %');
    expect(/class="n pct">0 %/.test(html)).toBe(false);
    expect(html).toContain('5–7 days after receiving the advance payment');
    expect(preset.validUntil).toBe('2026-10-29');
  });
  it('keeps pivot upgrades out of the total until staff explicitly accept them', () => {
    const first = { ...product, description: 'Pivot door', unitPrice: 19500 };
    const second = {
      ...first,
      id: crypto.randomUUID(),
      itemCode: 'D02',
      unitPrice: 16000,
    };
    const items = applySpecificationPreset([first, second], id, 'pivotExample');
    const optional = items.find((i) => i.kind === 'Optional')!;
    optional.unitPrice = 3000;
    expect(computeQuotationTotals(items).total).toBe(35500);
    const d = draftFromQuotation(q);
    d.items = items;
    expect(validateDraft(d, true)).toBeNull();
    const rendered = draftQuotation(q, d);
    expect(buildQuotationHtml(rendered, rendered.items)).toContain(
      'Optional — excluded from total'
    );
    const accepted = items.map((i) =>
      i.id === optional.id
        ? { ...i, ...changeComponentKind(i, first, 'Accessory') }
        : i
    );
    expect(computeQuotationTotals(accepted).total).toBe(38500);
  });
  it('keeps product quantity and included per-product quantities distinct', () => {
    const parent = { ...product, qty: 2 };
    const included = applySpecificationPreset(
      [parent],
      id,
      'shutterExample'
    ).find((i) => i.description === 'Remote control')!;
    expect(included.qty).toBe(3);
    expect(included.unit).toBe('per_product');
    const charge = changeComponentKind(included, parent, 'Accessory');
    expect(charge.qty).toBe(6);
    expect(charge.unit).toBe('piece');
    expect(
      changeComponentKind({ ...included, ...charge }, parent, 'Included').qty
    ).toBe(3);
  });
  it('removes a duplicate motor charge when applying a package that includes it', () => {
    const chargedMotor = {
      id: crypto.randomUUID(),
      itemType: 'line' as const,
      parentItemId: id,
      kind: 'Accessory',
      description: 'Motor',
      qty: 1,
      unitPrice: 500,
    };
    const applied = applySpecificationPreset(
      [product, chargedMotor],
      id,
      'shutterExample'
    );
    expect(applied.filter((i) => i.description === 'Motor')).toHaveLength(1);
    expect(applied.find((i) => i.id === chargedMotor.id)?.kind).toBe(
      'Included'
    );
    expect(computeQuotationTotals(applied).total).toBe(2400);
  });
  it('reapplying a specification does not duplicate parts or erase prices already entered', () => {
    const items = applySpecificationPreset([product], id, 'shutterExample');
    const once = applySpecificationPreset(items, id, 'shutterExample');
    expect(once).toHaveLength(items.length);
    expect(once[0].unitPrice).toBe(2400);
  });
  it('copies 70/30 terms with the correct payment trigger and preserves an existing warranty', () => {
    const draft = applyCommercialPreset(
      draftFromQuotation(q),
      'doorTerms',
      '2026-10-14'
    );
    expect(draft.warrantyTerms).toBe('One year');
    expect(draft.documentDetails.paymentSchedule).toMatchObject({
      advance: 70,
      delivery: 30,
      completion: 0,
      deliveryTrigger: 'before_installation',
    });
    draft.items = [product];
    const rendered = draftQuotation(q, draft);
    const html = buildQuotationHtml(rendered, rendered.items);
    expect(html).toContain('Before installation and completion');
    expect(html).toContain('30–35 days after receiving');
    expect(html).not.toContain('On delivery to site');
  });
  it('allows partial payment stages in a saved draft and blocks export until they total 100%', () => {
    const d = draftFromQuotation(q);
    d.items = [product];
    d.documentDetails.paymentSchedule = {
      advance: 70,
      delivery: 0,
      completion: 0,
    };
    expect(validateDraft(d)).toBeNull();
    expect(validateDraft(d, true)).toBe('invalidSchedule');
  });
  it('does not repopulate intentionally empty saved fields or price included items', () => {
    const d = draftFromQuotation({
      ...q,
      workspaceVersion: 1,
      paymentTerms: null,
      validUntil: null,
    });
    expect(d.paymentTerms).toBe('');
    expect(d.validUntil).toBe('');
    expect(
      computeQuotationTotals([{ ...product, kind: 'Included', unitPrice: 999 }])
        .total
    ).toBe(0);
  });
});

describe('product-specific specification examples', () => {
  it.each([
    ['Pivot door', 'pivotExample'],
    ['PIVOT DOOR – exterior', 'pivotExample'],
    ['باب محوري', 'pivotExample'],
    ['أبواب محورية', 'pivotExample'],
    ['Roll-up shutter', 'shutterExample'],
    ['Roller shutter', 'shutterExample'],
    ['باب رول', 'shutterExample'],
    ['Swing gate automation', 'gateExample'],
    ['نظام تشغيل بوابة مفصلية', 'gateExample'],
    ['Steel door', 'steelExample'],
    ['باب حديد', 'steelExample'],
  ])('shows only the appropriate example for %s', (description, key) => {
    expect(
      specificationPresetsForItem({ ...product, description }).map((p) => p.key)
    ).toEqual([key]);
  });
  it.each([
    'UPVC door / window',
    'Door',
    'Sliding gate',
    'Steel side frame',
    '',
    'Custom product',
  ])('does not offer unrelated examples for %s', (description) => {
    expect(specificationPresetsForItem({ ...product, description })).toEqual(
      []
    );
  });
  it('handles Arabic-only names and rejects conflicting bilingual names', () => {
    expect(
      specificationPresetsForItem({
        ...product,
        description: '',
        descriptionAr: 'باب محوري',
      }).map((p) => p.key)
    ).toEqual(['pivotExample']);
    expect(
      specificationPresetsForItem({
        ...product,
        description: 'Pivot door',
        descriptionAr: 'باب رول',
      })
    ).toEqual([]);
  });
  it('updates the examples when the product changes', () => {
    const item = { ...product, description: 'Pivot door' };
    expect(specificationPresetsForItem(item).map((p) => p.key)).toEqual([
      'pivotExample',
    ]);
    expect(
      specificationPresetsForItem({ ...item, description: 'Steel door' }).map(
        (p) => p.key
      )
    ).toEqual(['steelExample']);
  });
  it('rejects an unrelated selection without changing specifications or adding components', () => {
    const items = [
      {
        ...product,
        description: 'Pivot door',
        specification: 'Custom specification',
      },
    ];
    expect(applySpecificationPreset(items, id, 'shutterExample')).toBe(items);
    expect(items[0].specification).toBe('Custom specification');
  });
  it('does not offer or apply product presets to services or accessories', () => {
    for (const item of [
      { ...product, kind: 'Service' as const },
      { ...product, parentItemId: 'parent' },
    ]) {
      expect(specificationPresetsForItem(item)).toEqual([]);
      const items = [item];
      expect(applySpecificationPreset(items, id, 'shutterExample')).toBe(items);
    }
  });
});
