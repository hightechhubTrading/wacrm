// src/lib/quotations/types.ts
export type QuotationStatus = 'draft' | 'sent' | 'won' | 'lost' | 'expired';

export interface Quotation {
  id: string;
  accountId: string;
  reference: string;
  revision: number;
  status: QuotationStatus;
  clientName: string | null;
  clientPhone: string | null;
  clientCompany: string | null;
  location: string | null;
  projectName: string | null;
  subject: string | null;
  currency: string;
  contactId: string | null;
  dealId: string | null;
  assignedTo: string | null;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  validUntil: string | null;
  pdfStoragePath: string | null;
  createdAt: string;
}

export interface QuotationItem {
  id: string;
  quotationId: string;
  parentItemId: string | null;
  productId: string | null;
  position: number;
  itemType: 'section' | 'line';
  kind: string | null;
  itemCode: string | null;
  description: string | null;
  descriptionAr: string | null;
  sizeW: number | null;
  sizeH: number | null;
  qty: number | null;
  unitPrice: number | null;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  lineTotal: number;
}

// Postgres/PostgREST returns snake_case columns; the app works in
// camelCase throughout. A bare cast (`row as Quotation`) silently
// produces `undefined` for every field whose name isn't spelled
// identically in both conventions — found in Task 5's review, where
// only `reference`/`status` happened to match and hid the bug from the
// original test. Every quotation row reaching a client MUST go through
// this mapper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapQuotationRow(row: Record<string, any>): Quotation {
  return {
    id: row.id,
    accountId: row.account_id,
    reference: row.reference,
    revision: row.revision,
    status: row.status,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientCompany: row.client_company,
    location: row.location,
    projectName: row.project_name,
    subject: row.subject,
    currency: row.currency,
    contactId: row.contact_id,
    dealId: row.deal_id,
    assignedTo: row.assigned_to,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    total: row.total,
    validUntil: row.valid_until,
    pdfStoragePath: row.pdf_storage_path,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapQuotationItemRow(row: Record<string, any>): QuotationItem {
  return {
    id: row.id,
    quotationId: row.quotation_id,
    parentItemId: row.parent_item_id,
    productId: row.product_id,
    position: row.position,
    itemType: row.item_type,
    kind: row.kind,
    itemCode: row.item_code,
    description: row.description,
    descriptionAr: row.description_ar,
    sizeW: row.size_w,
    sizeH: row.size_h,
    qty: row.qty,
    unitPrice: row.unit_price,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    lineTotal: row.line_total,
  };
}
