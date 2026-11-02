export type KnowledgeKind =
  | 'product'
  | 'price'
  | 'client'
  | 'quotation'
  | 'invoice'
  | 'job'
  | 'component'
  | 'merge'
  | 'supplier'
  | 'supplier_code'
  | 'grid'
  | 'submittal'
  | 'delivery'
  | 'bom_rule'
  | 'bom_example'
  | 'coverage'
  | 'superseded'
  | 'document';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export interface KnowledgeRecord {
  id: string;
  batch_id: string;
  record_key: string;
  kind: KnowledgeKind;
  source: string;
  source_row: number;
  data: Record<string, string>;
  review_status: ReviewStatus;
  review_version: number;
  review_notes: string | null;
  reviewed_at: string | null;
  configuration: KnowledgeConfiguration;
}
export interface KnowledgeConfiguration {
  commercial?: {
    deliveryTerms?: string;
    paymentTerms?: string;
    warrantyTerms?: string;
    validityDays?: number;
  };
  catalogItemId?: string;
  family?: string;
  pricing?: {
    basis: 'area' | 'piece' | 'width' | 'width_band' | 'grid';
    rate: number;
    currency: 'QAR';
    column?: 'O' | 'P' | 'R' | 'S' | 'confirmed';
    minWidthCm?: number;
    maxWidthCm?: number;
    minHeightCm?: number;
    maxHeightCm?: number;
    fifthSheetQar?: number;
    manualAdjustmentQar?: number;
    minimumAreaM2?: number;
  };
  supplierCost?: {
    itemId: string;
    currency: string;
    price: number;
    unit: 'm' | 'piece' | 'pair' | 'set';
    metresPerPricedUnit: number;
    fxToQar: number;
    freightQarPerUnit: number;
    dutyQarPerUnit: number;
    clearingQarPerUnit: number;
    effectiveDate: string;
  };
}
export interface KnowledgeSnapshot {
  recordId: string;
  batchId: string;
  source: string;
  sourceRow: number;
  reviewVersion: number;
  reviewedAt: string;
  capturedAt: string;
  label: string;
  configuration: KnowledgeConfiguration;
  appliedUnitPrice?: number;
  appliedUnit?: string;
  input?: {
    width: number;
    height: number;
    measurementUnit: string;
    qty: number;
    fifthSheet: boolean;
    manual: boolean;
  };
}
export interface ShutterCostDraft {
  ruleVersion: '55mm-order-rules-v1';
  width: number;
  height: number;
  measurementUnit: string;
  qty: number;
  automatic: boolean;
  offers: Record<string, KnowledgeSnapshot>;
  quantities: Record<string, number>;
  extras: {
    labour: number | null;
    installation: number | null;
    delivery: number | null;
    other: number | null;
  };
}
export interface QuotationKnowledge {
  costEstimates?: Record<string, ShutterCostDraft>;
  prices: Record<string, KnowledgeSnapshot>;
  references: KnowledgeSnapshot[];
  manualOverrides?: {
    itemId: string;
    previous: KnowledgeSnapshot;
    reason: string;
    unitPrice: number;
    unit: string;
    at: string;
  }[];
}
export const KNOWLEDGE_KINDS: KnowledgeKind[] = [
  'product',
  'price',
  'client',
  'quotation',
  'invoice',
  'job',
  'component',
  'merge',
  'supplier',
  'supplier_code',
  'grid',
  'submittal',
  'delivery',
  'bom_rule',
  'bom_example',
  'coverage',
  'superseded',
  'document',
];
