/** Customer-facing mobile DTOs. Keep this file independent of server modules. */
export interface MobileQuotationSummary {
  id: string;
  reference: string;
  revision: number;
  status: string;
  clientName: string | null;
  projectName: string | null;
  currency: string | null;
  total: number;
  updatedAt?: string;
}
export interface MobileQuotation extends MobileQuotationSummary {
  clientPhone: string | null;
  clientCompany: string | null;
  subject: string | null;
  location: string | null;
  subtotal: number;
  discountAmount: number;
  workspaceVersion?: number;
  validUntil: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  warrantyTerms?: string | null;
}
export interface MobileQuotationItem {
  id: string;
  position: number;
  itemType: string;
  description: string | null;
  descriptionAr: string | null;
  specification?: string | null;
  qty: number | null;
  unit?: string | null;
  unitPrice: number | null;
  lineTotal: number;
}
export interface MobileQuotationDocument {
  id: string | null;
  revision: number;
  workspaceVersion: number;
  sendState: string;
  sentAt: string | null;
  messageId: string | null;
}
export interface MobileQuotationDetail {
  quotation: MobileQuotation;
  items: MobileQuotationItem[];
  itemsLimit: number;
  document: MobileQuotationDocument | null;
  conversationId: string | null;
}
export interface MobileQuotationList {
  quotations: MobileQuotationSummary[];
  total: number;
  nextOffset: number | null;
}
