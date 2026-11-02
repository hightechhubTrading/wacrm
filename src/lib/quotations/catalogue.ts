import type { QuotationItemToSave } from './crud';
import type { KnowledgeRecord, QuotationKnowledge } from './knowledge/types';
import { snapshot } from './knowledge/calculations';
import { normalizedQuantityUnit } from './knowledge/normalization';

export interface CatalogueProduct {
  id: string;
  name: string;
  name_ar: string | null;
  description: string;
  specifications: string;
  parent_id: string | null;
  kind: string;
  inventory_type: string;
  sku: string | null;
  unit_of_measure: string | null;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  customer_visible: boolean;
  aliases: string[];
  productCode?: string;
  familyName?: string;
  sources: KnowledgeRecord[];
}
export interface CatalogueTerms {
  deliveryTerms: string;
  paymentTerms: string;
  warrantyTerms: string;
}
export interface CatalogueSelection {
  productId: string;
  paymentOption?: number;
  applyTerms?: boolean;
  price?: { recordId: string; column: 'O' | 'P' | 'R' | 'S' };
}
export interface CatalogueSeed {
  item: QuotationItemToSave;
  knowledge?: QuotationKnowledge;
}
export function cataloguePaymentOptions(value: string): string[] {
  const options: string[] = [];
  if (/100\s*%/.test(value)) options.push('100% advance payment.');
  for (const m of value.matchAll(
    /\b(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/g
  )) {
    const parts = m.slice(1).filter(Boolean).map(Number);
    if (parts.reduce((n, v) => n + v, 0) === 100)
      options.push(
        `Payment split: ${parts.map((n) => `${n}%`).join(' / ')}. Milestones to be specified in this quotation.`
      );
  }
  if (!options.length && value.trim())
    options.push(
      value
        .replace(/\bthen staged\b/g, 'with subsequent staged payments')
        .replace(/\bstaged\b/g, 'staged payments')
    );
  return [...new Set(options)];
}
export function catalogueTerms(
  product: CatalogueProduct,
  paymentOption?: number
): CatalogueTerms {
  const r = product.sources.find((s) => s.kind === 'product'),
    d = r?.data;
  const options = cataloguePaymentOptions(d?.standard_payment ?? '');
  const paymentTerms =
    paymentOption !== undefined
      ? (options[paymentOption] ?? '')
      : options.length === 1
        ? options[0]
        : '';
  const explicit = product.specifications.match(
    /(?:Recorded )?(?:standard )?installation(?: period)?:\s*([^.;\n]+)/i
  )?.[1];
  const delivery = explicit ?? d?.standard_delivery ?? '';
  // Broad historic project ranges remain available in the source, rather than becoming a new commitment automatically.
  const broad = delivery.match(/(\d+)\s*[-–]\s*(\d+)\s*days/i);
  const deliveryTerms =
    broad && Number(broad[2]) - Number(broad[1]) > 60
      ? ''
      : delivery
        ? `Delivery / installation: ${delivery.replace(/\bRecorded\s*/gi, '')}.`
        : '';
  const warranty = d?.warranty ?? '';
  return {
    deliveryTerms,
    paymentTerms,
    warrantyTerms: /per quote/i.test(warranty)
      ? ''
      : warranty
        ? `Warranty: ${warranty}.`
        : '',
  };
}
export function quotationSpecification(
  p: Pick<CatalogueProduct, 'specifications' | 'description'>
) {
  const text = p.specifications.trim() || p.description;
  return text
    .split('\n')
    .filter(
      (l) =>
        !/^Current observed|^التكوين الحالي المرصود|^Source:|^المصدر:/i.test(
          l.trim()
        )
    )
    .join('\n')
    .replace(/The documented offer includes/gi, 'Includes')
    .replace(/The company submittal documents /gi, '')
    .replace(/\bRecorded (?:standard )?/gi, '')
    .trim();
}
export function cataloguePriceUnit(r: KnowledgeRecord): string | null {
  const u = (r.data.unit ?? '').trim().toLowerCase();
  if (['per door', 'per window', 'per box'].includes(u)) return 'piece';
  if (u === 'per job') return 'job';
  if (u === 'per m width') return 'm';
  const unit = normalizedQuantityUnit(u);
  return unit && ['piece', 'm', 'm2', 'set', 'pair', 'job'].includes(unit)
    ? unit
    : null;
}
export function cataloguePriceRows(p: CatalogueProduct) {
  return p.sources.filter(
    (r) =>
      r.kind === 'price' &&
      cataloguePriceUnit(r) &&
      (!r.configuration.catalogItemId || r.configuration.catalogItemId === p.id)
  );
}
export function catalogueItem(
  p: CatalogueProduct,
  id: string,
  itemCode: string,
  choice?: CatalogueSelection['price'],
  currency = 'QAR'
): { item: QuotationItemToSave; knowledge?: QuotationKnowledge } {
  const unit =
    p.unit_of_measure ??
    {
      per_square_meter: 'm2',
      per_meter: 'm',
      per_item: 'piece',
      per_project: 'job',
    }[p.price_unit ?? ''] ??
    'piece';
  const item: QuotationItemToSave = {
    id,
    itemCode,
    itemType: 'line',
    productId: p.id,
    description: p.name,
    descriptionAr: p.name_ar ?? '',
    specification: quotationSpecification(p),
    unit,
    measurementUnit: 'cm',
    qty: 1,
    kind: p.inventory_type === 'service' ? 'Service' : undefined,
    unitPrice:
      currency === 'QAR' && p.price_min !== null && p.price_min === p.price_max
        ? p.price_min
        : undefined,
  };
  if (!choice) return { item };
  if (currency !== 'QAR')
    throw Error(
      'Recorded QAR prices require a QAR quotation. Enter another currency rate explicitly.'
    );
  const r = cataloguePriceRows(p).find((r) => r.id === choice.recordId);
  if (!r || !['O', 'P', 'R', 'S'].includes(choice.column))
    throw Error('Choose a recorded price linked to this product.');
  const raw = r.data[`col_${choice.column}`],
    rate = Number(raw);
  if (!raw || !Number.isFinite(rate) || rate < 0)
    throw Error('This source column has no valid rate.');
  const original = snapshot(r);
  item.unit = cataloguePriceUnit(r)!;
  item.unitPrice = rate;
  return {
    item,
    knowledge: {
      prices: {},
      references: [original],
      manualOverrides: [
        {
          itemId: id,
          previous: original,
          unit: item.unit as 'piece',
          unitPrice: rate,
          reason: `Selected recorded column ${choice.column}, ${r.data.item_en ?? r.record_key}; source ${r.source}:${r.source_row}, basis ${r.data.unit}.`,
          at: new Date().toISOString(),
        },
      ],
    },
  };
}
export function mergeCatalogueKnowledge(
  existing: QuotationKnowledge | undefined,
  added: QuotationKnowledge | undefined
): QuotationKnowledge | undefined {
  if (!added) return existing;
  const references = [...(existing?.references ?? [])];
  for (const r of added.references)
    if (
      !references.some(
        (x) => x.recordId === r.recordId && x.reviewVersion === r.reviewVersion
      )
    )
      references.push(r);
  return {
    ...existing,
    prices: existing?.prices ?? {},
    references,
    manualOverrides: [
      ...(existing?.manualOverrides ?? []),
      ...(added.manualOverrides ?? []),
    ],
  };
}

export function parseCatalogueSelection(value: unknown): CatalogueSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Choose a catalogue product.');
  const v = value as Record<string, unknown>,
    uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof v.productId !== 'string' || !uuid.test(v.productId))
    throw Error('Choose a valid catalogue product.');
  if (v.applyTerms !== undefined && typeof v.applyTerms !== 'boolean')
    throw Error('Choose whether to use recorded terms.');
  if (
    v.paymentOption !== undefined &&
    (!Number.isInteger(v.paymentOption) ||
      Number(v.paymentOption) < 0 ||
      Number(v.paymentOption) > 20)
  )
    throw Error('Choose a valid payment option.');
  let price: CatalogueSelection['price'];
  if (v.price !== undefined) {
    const p = v.price as Record<string, unknown>;
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.recordId !== 'string' ||
      !uuid.test(p.recordId) ||
      !['O', 'P', 'R', 'S'].includes(String(p.column))
    )
      throw Error('Choose a valid recorded source price.');
    price = { recordId: p.recordId, column: p.column as 'O' };
  }
  return {
    productId: v.productId,
    applyTerms: v.applyTerms as boolean | undefined,
    paymentOption: v.paymentOption as number | undefined,
    price,
  };
}

export function applyCatalogueCapture(
  draft: import('./workspace').QuotationDraft,
  added: QuotationKnowledge | undefined,
  terms: CatalogueTerms | undefined,
  itemId: string,
  resetPricing = true
): import('./workspace').QuotationDraft {
  const details = { ...draft.documentDetails };
  let existing = details.knowledge;
  if (existing && resetPricing) {
    const prices = { ...existing.prices },
      references = [...existing.references],
      costEstimates = { ...existing.costEstimates };
    if (
      prices[itemId] &&
      !references.some(
        (r) =>
          r.recordId === prices[itemId].recordId &&
          r.reviewVersion === prices[itemId].reviewVersion
      )
    )
      references.push(prices[itemId]);
    delete prices[itemId];
    delete costEstimates[itemId];
    existing = { ...existing, prices, references, costEstimates };
  }
  const knowledge = mergeCatalogueKnowledge(existing, added);
  if (knowledge) details.knowledge = knowledge;
  if (terms) {
    delete details.commercialPreset;
    delete details.paymentSchedule;
  }
  return { ...draft, ...(terms ?? {}), documentDetails: details };
}
