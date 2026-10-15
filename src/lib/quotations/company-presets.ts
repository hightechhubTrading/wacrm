import type { QuotationItemToSave } from './crud';
import type { QuotationDraft } from './workspace';
import { nextItemCode } from './item-editor';

// These are editable examples from the quotations supplied by the user,
// not approved specifications for every future product or job.
export const SPECIFICATION_PRESETS = [
  {
    key: 'shutterExample',
    specification:
      'Electrically operated roll-up door.\n0.5 mm sheet; manual and electric operation.\nFinish: white or beige — confirm selected color.',
    included: [
      { en: 'Motor', ar: 'محرك', qty: 1 },
      { en: 'Push button', ar: 'زر تشغيل', qty: 1 },
      { en: 'Remote control', ar: 'ريموت تحكم', qty: 3 },
    ],
    optional: [],
  },
  {
    key: 'pivotExample',
    specification:
      'Door thickness: 7 cm.\nTwo rubber seals for sound and water insulation.\nThermal and acoustic insulating foam.\nWaterproof wood core.\nExternal cladding resistant to water, heat and weather.\nSide frame thickness: 7 cm.\nLocking system: manual or electronic — confirm selection.',
    included: [],
    optional: [
      {
        en: 'Electronic lock (Philips or equivalent)',
        ar: 'قفل إلكتروني (فيليبس أو ما يعادله)',
        qty: 1,
      },
      { en: 'Custom handle', ar: 'مقبض حسب الطلب', qty: 1 },
    ],
  },
  {
    key: 'gateExample',
    specification:
      'Supply and installation of swing gate automation (CAME Model 1800).\n230 V power supply connection; confirm site power requirements and selected model.',
    included: [
      { en: 'Control panel', ar: 'لوحة تحكم', qty: 1 },
      { en: 'Remote control', ar: 'ريموت تحكم', qty: 2 },
      { en: 'Safety photocell', ar: 'خلية ضوئية للسلامة', qty: 1 },
      { en: '4-meter rack', ar: 'راك 4 أمتار', qty: 1 },
      { en: 'Extra rack', ar: 'راك إضافي', qty: 1 },
      { en: 'Outdoor key switch', ar: 'مفتاح تشغيل خارجي', qty: 1 },
    ],
    optional: [],
  },
  {
    key: 'steelExample',
    specification:
      'Supply and installation of a double-leaf iron door according to the selected design.\nPainting in three stages: primer, epoxy and selected color.',
    included: [],
    optional: [],
  },
] as const;
export function applySpecificationPreset(
  items: QuotationItemToSave[],
  id: string,
  key: string
): QuotationItemToSave[] {
  const preset = SPECIFICATION_PRESETS.find((p) => p.key === key);
  const parent = items.find((i) => i.id === id);
  if (!preset || !parent || parent.parentItemId || parent.itemType !== 'line')
    return items;
  const result = items.map((i) =>
    i.id === id ? { ...i, specification: preset.specification } : i
  );
  const additions: QuotationItemToSave[] = [];
  for (const [kind, components] of [
    ['Included', preset.included],
    ['Optional', preset.optional],
  ] as const) {
    for (const component of components) {
      // A known package inclusion replaces an existing separate charge for
      // the same component. Preserve accepted optional upgrades and custom extras.
      const existingIndex = result.findIndex(
        (i) =>
          i.parentItemId === id &&
          [
            i.description?.trim().toLocaleLowerCase(),
            i.descriptionAr?.trim(),
          ].some(
            (name) =>
              name === component.en.toLocaleLowerCase() || name === component.ar
          )
      );
      if (existingIndex >= 0) {
        if (kind === 'Included')
          result[existingIndex] = {
            ...result[existingIndex],
            ...changeComponentKind(result[existingIndex], parent, 'Included'),
            qty: component.qty,
            unit: 'per_product',
          };
        continue;
      }
      const item: QuotationItemToSave = {
        id: crypto.randomUUID(),
        itemType: 'line',
        parentItemId: id,
        kind,
        description: component.en,
        descriptionAr: component.ar,
        qty:
          kind === 'Included'
            ? component.qty
            : component.qty * (parent.qty ?? 1),
        unit: kind === 'Included' ? 'per_product' : 'piece',
        itemCode: nextItemCode([...result, ...additions], 'A'),
      };
      additions.push(item);
    }
  }
  const index = result.reduce(
    (n, i, index) => (i.id === id || i.parentItemId === id ? index + 1 : n),
    0
  );
  return [...result.slice(0, index), ...additions, ...result.slice(index)];
}
export function changeComponentKind(
  item: QuotationItemToSave,
  parent: QuotationItemToSave,
  kind: 'Included' | 'Accessory' | 'Optional'
): Partial<QuotationItemToSave> {
  const wasPerProduct = item.unit === 'per_product';
  const quantity = item.qty ?? 1;
  return {
    kind,
    unit:
      kind === 'Included' ? 'per_product' : wasPerProduct ? 'piece' : item.unit,
    qty:
      kind === 'Included'
        ? wasPerProduct
          ? quantity
          : quantity / (parent.qty ?? 1)
        : wasPerProduct
          ? quantity * (parent.qty ?? 1)
          : quantity,
    unitPrice: kind === 'Included' ? undefined : item.unitPrice,
    discountType: kind === 'Accessory' ? item.discountType : undefined,
    discountValue: kind === 'Accessory' ? item.discountValue : undefined,
  };
}
export const COMMERCIAL_PRESETS = [
  {
    key: 'shutterTerms',
    deliveryTerms:
      '5–7 days after receiving the advance payment.\n5–7 أيام بعد استلام الدفعة المقدمة.',
    warrantyTerms:
      'One year including spare parts.\nسنة واحدة تشمل قطع الغيار.',
    schedule: {
      advance: 100,
      delivery: 0,
      completion: 0,
      deliveryTrigger: 'before_installation' as const,
    },
  },
  {
    key: 'doorTerms',
    deliveryTerms:
      '30–35 days after receiving the advance payment.\n30–35 يوماً بعد استلام الدفعة المقدمة.',
    warrantyTerms: undefined,
    schedule: {
      advance: 70,
      delivery: 30,
      completion: 0,
      deliveryTrigger: 'before_installation' as const,
    },
  },
] as const;
export function applyCommercialPreset(
  draft: QuotationDraft,
  key: string,
  today: string
): QuotationDraft {
  const preset = COMMERCIAL_PRESETS.find((p) => p.key === key);
  if (!preset) return draft;
  const validUntil = new Date(`${today}T12:00:00Z`);
  validUntil.setUTCDate(validUntil.getUTCDate() + 15);
  return {
    ...draft,
    deliveryTerms: preset.deliveryTerms,
    paymentTerms: '',
    warrantyTerms: preset.warrantyTerms ?? draft.warrantyTerms,
    validUntil: validUntil.toISOString().slice(0, 10),
    documentDetails: {
      ...draft.documentDetails,
      commercialPreset: key,
      paymentSchedule: { ...preset.schedule },
    },
  };
}
