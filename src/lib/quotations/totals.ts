// src/lib/quotations/totals.ts
//
// Pure calculation, no I/O — runs identically in the browser (live
// total as a rep edits) and on the server (source of truth on save).
// Section headers (item_type: 'section') never contribute to the
// total. Every other item — top-level product or accessory/
// customization sub-item, distinguished only by parentItemId — is
// summed the same way, per spec: "everything is a quotation_item."

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
  discountType?: DiscountType;
  discountValue?: number;
}

export interface QuotationTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
  itemTotals: Record<string, number>;
}

function applyDiscount(amount: number, type: DiscountType | undefined, value: number | undefined): number {
  if (!type || !value) return amount;
  const discount = type === 'percent' ? amount * (value / 100) : value;
  return Math.max(0, amount - discount);
}

export function computeQuotationTotals(
  items: QuotationItemInput[],
  orderDiscount?: OrderDiscount,
): QuotationTotals {
  const itemTotals: Record<string, number> = {};
  let subtotal = 0;

  for (const item of items) {
    if (item.itemType === 'section') continue;
    const qty = item.qty ?? 1;
    const unitPrice = item.unitPrice ?? 0;
    const lineTotal = applyDiscount(qty * unitPrice, item.discountType, item.discountValue);
    itemTotals[item.id] = lineTotal;
    subtotal += lineTotal;
  }

  const total = orderDiscount
    ? applyDiscount(subtotal, orderDiscount.discountType, orderDiscount.discountValue)
    : subtotal;
  const discountAmount = subtotal - total;

  return { subtotal, discountAmount, total, itemTotals };
}
