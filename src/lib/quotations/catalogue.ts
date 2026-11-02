import {
  paymentOptions,
  mergePaymentOptions,
  paymentOptionLabel,
  optionPlan,
  type PaymentPlan,
} from './payment-plan';
import { productProfile, customerSpecification } from './product-profile';
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
  deliveryPeriod?: string;
  customDeliveryPeriod?: string;
  sources: KnowledgeRecord[];
}
export interface CatalogueTerms {
  deliveryTerms: string;
  paymentTerms: string;
  warrantyTerms: string;
  paymentPlan?: PaymentPlan;
}
export interface CatalogueSelection {
  productId: string;
  paymentOption?: number;
  applyTerms?: boolean;
  componentKind?: 'Included' | 'Accessory' | 'Optional';
  price?: { recordId: string; column: 'O' | 'P' | 'R' | 'S' };
}
export interface CatalogueSeed {
  item: QuotationItemToSave;
  knowledge?: QuotationKnowledge;
}
export function cataloguePaymentOptions(value: string): string[] {
  return paymentOptions(value).map((o) => paymentOptionLabel(o));
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
  const delivery =
    explicit ?? product.deliveryPeriod ?? d?.standard_delivery ?? '';
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
    paymentPlan: optionPlan(
      paymentOptions(d?.standard_payment ?? '')[
        paymentOption ?? (options.length === 1 ? 0 : -1)
      ] ?? { key: 'none' }
    ),
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
  return customerSpecification(p.specifications.trim() || p.description).join(
    '\n'
  );
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
  return p.sources.filter((r) => {
    if (
      r.kind !== 'price' ||
      !cataloguePriceUnit(r) ||
      (r.configuration.catalogItemId && r.configuration.catalogItemId !== p.id)
    )
      return false;
    if (p.inventory_type !== 'product') return true;
    const name = r.data.item_en ?? '',
      unit = r.data.unit ?? '',
      code = productProfile(p).code;
    if (code === 'WS')
      return /per m2/.test(unit) && /window shutter/i.test(name);
    if (/sectional/i.test(p.name))
      return /sectional/i.test(name) && /per door|per m2/.test(unit);
    if (/polycarbonate/i.test(p.name))
      return /polycarbonate/i.test(name) && /per door|per m2/.test(unit);
    if (/perforated/i.test(p.name))
      return /perforated/i.test(name) && /per door|per m2/.test(unit);
    if (/solid steel/i.test(p.name))
      return /steel|solid/i.test(name) && /per door|per m2/.test(unit);
    if (/Australian/i.test(p.name))
      return /roll.?up|australian/i.test(name) && /per door|per m2/.test(unit);
    if (['SL', 'SW', 'GB'].includes(code))
      return (
        /operator|motor|barrier/i.test(name) &&
        !/remote|receiver|switch|control|photocell/i.test(name)
      );
    return (
      !/per motor|per unit/.test(unit) ||
      (/door|screen|glass|window/i.test(name) &&
        !/motor|remote|receiver|switch/i.test(name))
    );
  });
}

export function catalogueItem(
  p: CatalogueProduct,
  id: string,
  itemCode: string,
  choice?: CatalogueSelection['price'],
  currency = 'QAR'
): { item: QuotationItemToSave; knowledge?: QuotationKnowledge } {
  const unit = productProfile(p).unit;
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
          unit: item.unit,
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
    prices: { ...existing?.prices, ...added.prices },
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
    details.paymentPlan = terms.paymentPlan;
  }
  return { ...draft, ...(terms ?? {}), documentDetails: details };
}

export function productPaymentOptions(product: CatalogueProduct) {
  const values = product.sources
    .filter((r) => r.kind === 'product')
    .map((r) => r.data.standard_payment ?? '');
  const explicit = product.specifications.match(
    /Offer payments:\s*([^\n]+)/i
  )?.[1];
  if (explicit) values.push(explicit);
  return mergePaymentOptions(values.flatMap(paymentOptions));
}
