// src/lib/quotations/totals.ts
//
// Pure calculation, no I/O — runs identically in the browser (live
// total as a rep edits) and on the server (source of truth on save).
// Section headers (item_type: 'section') never contribute to the
// total. Included components share their parent package price; optional
// upgrades are excluded until explicitly converted to chargeable extras.
// Area-priced products use count × physical area × m² rate; other lines use quantity × price.

export type DiscountType = 'percent' | 'fixed';

export interface OrderDiscount {
  discountType: DiscountType;
  discountValue: number;
}

export interface QuotationItemInput {
  id: string;
  itemType: 'section' | 'line';
  parentItemId?: string;
  kind?: string;
  qty?: number;
  unitPrice?: number;
  unit?: string;
  sizeW?: number;
  sizeH?: number;
  measurementUnit?: string;
  discountType?: DiscountType;
  discountValue?: number;
}

/** Dimensions describe one opening; quantity always remains the number of openings. */
export function areaPerItem(
  item: Pick<QuotationItemInput, 'sizeW' | 'sizeH' | 'measurementUnit'>
): number {
  const divisor =
    item.measurementUnit === 'm'
      ? 1
      : item.measurementUnit === 'cm'
        ? 10000
        : 1000000;
  return ((item.sizeW ?? 0) * (item.sizeH ?? 0)) / divisor;
}
export function billableQuantity(
  item: Pick<
    QuotationItemInput,
    'qty' | 'unit' | 'sizeW' | 'sizeH' | 'measurementUnit'
  >
): number {
  return (item.qty ?? 1) * (item.unit === 'm2' ? areaPerItem(item) : 1);
}

export function isNonChargeable(item: { kind?: string | null }): boolean {
  return item.kind === 'Included' || item.kind === 'Optional';
}

export interface QuotationTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
  itemTotals: Record<string, number>;
}

function applyDiscount(
  amount: number,
  type: DiscountType | undefined,
  value: number | undefined
): number {
  if (!type || !value) return amount;
  const discount = type === 'percent' ? amount * (value / 100) : value;
  return Math.max(0, amount - discount);
}

export function computeQuotationTotals(
  items: QuotationItemInput[],
  orderDiscount?: OrderDiscount
): QuotationTotals {
  const itemTotals: Record<string, number> = {};
  let subtotal = 0;

  for (const item of items) {
    if (item.itemType === 'section') continue;
    if (isNonChargeable(item)) {
      itemTotals[item.id] = 0;
      continue;
    }
    const qty = billableQuantity(item);
    const unitPrice = item.unitPrice ?? 0;
    const lineTotal =
      Math.round(
        (applyDiscount(qty * unitPrice, item.discountType, item.discountValue) +
          Number.EPSILON) *
          100
      ) / 100;
    itemTotals[item.id] = lineTotal;
    subtotal += lineTotal;
  }

  subtotal = Math.round((subtotal + Number.EPSILON) * 100) / 100;
  const unroundedTotal = orderDiscount
    ? applyDiscount(
        subtotal,
        orderDiscount.discountType,
        orderDiscount.discountValue
      )
    : subtotal;
  const total = Math.round((unroundedTotal + Number.EPSILON) * 100) / 100;
  const discountAmount = Math.round((subtotal - total) * 100) / 100;

  return { subtotal, discountAmount, total, itemTotals };
}
