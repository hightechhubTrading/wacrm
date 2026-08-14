// src/lib/quotations/crud.ts
import { supabaseAdmin } from './admin-client';
import { getNextQuotationReference } from './reference';
import { computeQuotationTotals, type QuotationItemInput, type OrderDiscount } from './totals';
import { mapQuotationRow, type Quotation } from './types';

export interface CreateQuotationInput {
  accountId: string;
  productCode: string;
  currency: string;
  createdBy?: string;
  assignedTo?: string;
  contactId?: string;
  dealId?: string;
  clientName?: string;
  clientPhone?: string;
  clientCompany?: string;
}

// Wider than QuotationItemInput (Task 3), which stays narrow on purpose —
// it only carries what computeQuotationTotals needs for arithmetic. This
// is what actually gets persisted, so it carries the display fields too.
export interface QuotationItemToSave extends QuotationItemInput {
  productId?: string;
  itemCode?: string;
  description?: string;
  descriptionAr?: string;
  sizeW?: number;
  sizeH?: number;
}

export async function createQuotation(input: CreateQuotationInput): Promise<Quotation> {
  const reference = await getNextQuotationReference(input.accountId, input.productCode);

  const { data, error } = await supabaseAdmin()
    .from('quotations')
    .insert({
      account_id: input.accountId,
      reference,
      currency: input.currency,
      created_by: input.createdBy ?? null,
      assigned_to: input.assignedTo ?? null,
      contact_id: input.contactId ?? null,
      deal_id: input.dealId ?? null,
      client_name: input.clientName ?? null,
      client_phone: input.clientPhone ?? null,
      client_company: input.clientCompany ?? null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapQuotationRow(data);
}

export async function saveQuotationItems(
  quotationId: string,
  accountId: string,
  items: QuotationItemToSave[],
  orderDiscount?: OrderDiscount,
): Promise<void> {
  const totals = computeQuotationTotals(items, orderDiscount);

  const payload = items.map((item, index) => ({
    id: item.id,
    parent_item_id: item.parentItemId ?? null,
    product_id: item.productId ?? null,
    position: index,
    item_type: item.itemType,
    kind: item.kind ?? null,
    item_code: item.itemCode ?? null,
    description: item.description ?? null,
    description_ar: item.descriptionAr ?? null,
    size_w: item.sizeW ?? null,
    size_h: item.sizeH ?? null,
    qty: item.qty ?? 1,
    unit_price: item.unitPrice ?? 0,
    discount_type: item.discountType ?? null,
    discount_value: item.discountValue ?? null,
    line_total: totals.itemTotals[item.id] ?? 0,
  }));

  const { error } = await supabaseAdmin().rpc('save_quotation_items', {
    p_quotation_id: quotationId,
    p_account_id: accountId,
    p_items: payload,
    p_subtotal: totals.subtotal,
    p_discount_amount: totals.discountAmount,
    p_total: totals.total,
  });
  if (error) throw new Error(error.message);
}
