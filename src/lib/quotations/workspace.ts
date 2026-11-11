import { validReferenceImage } from './reference-image';
import { fitPaymentPlan } from './payment-plan';
import {
  validPaymentPlan,
  legacyPaymentPlan,
  paymentOptions,
  optionPlan,
} from './payment-plan';
import {
  computeQuotationTotals,
  billableQuantity,
  isNonChargeable,
  type OrderDiscount,
} from './totals';
import type { QuotationItemToSave } from './crud';
import type {
  Quotation,
  QuotationDocumentDetails,
  QuotationItem,
} from './types';
import { validQuotationKnowledge } from './knowledge/validation';
import { knowledgeExportError } from './knowledge/calculations';

export type QuotationWithItems = Quotation & { items: QuotationItem[] };
export interface QuotationDraft {
  clientName: string;
  clientPhone: string;
  clientCompany: string;
  location: string;
  projectName: string;
  subject: string;
  validUntil: string;
  contactId: string | null;
  dealId: string | null;
  deliveryTerms: string;
  paymentTerms: string;
  warrantyTerms: string;
  documentDetails: QuotationDocumentDetails;
  items: QuotationItemToSave[];
  orderDiscount?: OrderDiscount;
}
import { DEFAULT_INCLUDED, DEFAULT_EXCLUDED } from './commercial-defaults';
export { DEFAULT_INCLUDED, DEFAULT_EXCLUDED } from './commercial-defaults';
export const DEFAULT_COMMERCIAL_TERMS = {
  deliveryTerms:
    'Delivery period to be agreed from receipt of the advance payment.\nتُحدد مدة التسليم من تاريخ استلام الدفعة المقدمة.',
  paymentTerms:
    'Payment stages and amounts to be agreed before order acceptance.\nتُحدد مراحل الدفع والمبالغ قبل اعتماد الطلب.',
  warrantyTerms: 'One year from handover · سنة واحدة من تاريخ التسليم',
};
export function draftFromQuotation(
  q: QuotationWithItems,
  applyDefaults = true
): QuotationDraft {
  const defaults =
    applyDefaults && q.status === 'draft' && (q.workspaceVersion ?? 0) === 0;
  const catalogueSeed =
    q.status === 'draft' && (q.workspaceVersion ?? 0) === 0 && !q.items.length
      ? q.documentDetails?.catalogueSeed
      : undefined;
  const documentDetails = { ...q.documentDetails };
  delete documentDetails.catalogueSeed;
  if (
    q.status === 'draft' &&
    applyDefaults &&
    documentDetails.included &&
    [catalogueSeed?.item, ...q.items].some(
      (i) =>
        i &&
        (documentDetails.included === i.specification ||
          documentDetails.included === i.description)
    )
  )
    documentDetails.included = DEFAULT_INCLUDED;
  if (q.status === 'draft' && applyDefaults) documentDetails.formatVersion = 2;
  if (q.status === 'draft' && applyDefaults && !documentDetails.paymentPlan) {
    if (documentDetails.paymentSchedule) {
      documentDetails.paymentPlan = legacyPaymentPlan(
        documentDetails.paymentSchedule
      );
    } else {
      const options = paymentOptions(q.paymentTerms ?? '');
      if (options.length === 1)
        documentDetails.paymentPlan = optionPlan(options[0]);
    }
  }
  if (q.status === 'draft' && applyDefaults && documentDetails.paymentPlan) {
    documentDetails.paymentPlan = fitPaymentPlan(documentDetails.paymentPlan);
  }
  const validity = new Date(
    `${new Date(q.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' })}T12:00:00Z`
  );
  validity.setUTCDate(validity.getUTCDate() + 15);
  return {
    clientName: q.clientName ?? '',
    clientPhone: q.clientPhone ?? '',
    clientCompany: q.clientCompany ?? '',
    location: q.location ?? '',
    projectName: q.projectName ?? '',
    subject: q.subject ?? '',
    validUntil:
      q.validUntil ?? (defaults ? validity.toISOString().slice(0, 10) : ''),
    contactId: q.contactId,
    dealId: q.dealId,
    deliveryTerms:
      q.deliveryTerms ??
      (defaults ? DEFAULT_COMMERCIAL_TERMS.deliveryTerms : ''),
    paymentTerms:
      q.paymentTerms ??
      (defaults && !q.documentDetails?.paymentSchedule
        ? DEFAULT_COMMERCIAL_TERMS.paymentTerms
        : ''),
    warrantyTerms:
      q.warrantyTerms ??
      (defaults ? DEFAULT_COMMERCIAL_TERMS.warrantyTerms : ''),
    documentDetails: {
      included: DEFAULT_INCLUDED,
      excluded: DEFAULT_EXCLUDED,
      ...documentDetails,
    },
    items: catalogueSeed
      ? [{ ...catalogueSeed.item }]
      : [...q.items]
          .sort((a, b) => a.position - b.position)
          .map((i) => ({
            id: i.id,
            itemType: i.itemType,
            parentItemId: i.parentItemId ?? undefined,
            productId: i.productId ?? undefined,
            kind: i.kind ?? undefined,
            itemCode: i.itemCode ?? undefined,
            description: i.description ?? '',
            descriptionAr: i.descriptionAr ?? '',
            specification: i.specification ?? '',
            unit: i.unit ?? 'piece',
            measurementUnit: i.measurementUnit ?? 'mm',
            sizeW: i.sizeW ?? undefined,
            sizeH: i.sizeH ?? undefined,
            qty: i.qty ?? 1,
            unitPrice: i.unitPrice ?? undefined,
            discountType: i.discountType ?? undefined,
            discountValue: i.discountValue ?? undefined,
          })),
    orderDiscount: q.discountType
      ? { discountType: q.discountType, discountValue: q.discountValue ?? 0 }
      : undefined,
  };
}
export function draftQuotation(
  q: Quotation,
  draft: QuotationDraft
): QuotationWithItems {
  const totals = computeQuotationTotals(draft.items, draft.orderDiscount);
  return {
    ...q,
    ...draft,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    total: totals.total,
    discountType: draft.orderDiscount?.discountType ?? null,
    discountValue: draft.orderDiscount?.discountValue ?? null,
    items: draft.items.map((i, position) => ({
      ...i,
      quotationId: q.id,
      position,
      parentItemId: i.parentItemId ?? null,
      productId: i.productId ?? null,
      kind: i.kind ?? null,
      itemCode: i.itemCode ?? null,
      description: i.description ?? null,
      descriptionAr: i.descriptionAr ?? null,
      sizeW: i.sizeW ?? null,
      sizeH: i.sizeH ?? null,
      qty: i.qty ?? 1,
      unitPrice: i.unitPrice ?? null,
      discountType: i.discountType ?? null,
      discountValue: i.discountValue ?? null,
      lineTotal: totals.itemTotals[i.id] ?? 0,
    })),
  };
}
export function draftFields(d: QuotationDraft) {
  const clean = (s: string) => s.trim() || null;
  return {
    client_name: clean(d.clientName),
    client_phone: clean(d.clientPhone),
    client_company: clean(d.clientCompany),
    location: clean(d.location),
    project_name: clean(d.projectName),
    subject: clean(d.subject),
    valid_until: d.validUntil || null,
    contact_id: d.contactId,
    deal_id: d.dealId,
    delivery_terms: clean(d.deliveryTerms),
    payment_terms: clean(d.paymentTerms),
    warranty_terms: clean(d.warrantyTerms),
    document_details: d.documentDetails,
    discount_type: d.orderDiscount?.discountType ?? null,
    discount_value: d.orderDiscount?.discountValue ?? null,
  };
}
export type DraftError =
  | 'invalidDraft'
  | 'referenceImageInvalid'
  | 'invalidItem'
  | 'invalidDiscount'
  | 'invalidSchedule'
  | 'configurationRequired'
  | 'customerRequired'
  | 'subjectRequired'
  | 'itemsRequired'
  | 'priceRequired'
  | 'areaDimensionsRequired'
  | 'validityRequired'
  | 'termsRequired'
  | 'unsupportedCurrency'
  | 'staleKnowledgePrice';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
export function validateDraft(
  value: unknown,
  forExport = false,
  currency = 'QAR'
): DraftError | null {
  if (!value || typeof value !== 'object') return 'invalidDraft';
  const d = value as QuotationDraft;
  if (
    [
      'clientName',
      'clientPhone',
      'clientCompany',
      'location',
      'projectName',
      'subject',
      'validUntil',
      'deliveryTerms',
      'paymentTerms',
      'warrantyTerms',
    ].some(
      (k) =>
        typeof d[k as keyof QuotationDraft] !== 'string' ||
        (d[k as keyof QuotationDraft] as string).length > 10000
    )
  )
    return 'invalidDraft';
  if (
    !Array.isArray(d.items) ||
    d.items.length > 300 ||
    !d.documentDetails ||
    typeof d.documentDetails !== 'object'
  )
    return 'invalidDraft';
  if (
    [d.contactId, d.dealId].some(
      (id) => id !== null && (typeof id !== 'string' || !uuid.test(id))
    )
  )
    return 'invalidDraft';
  if (
    d.validUntil &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(d.validUntil) ||
      !Number.isFinite(Date.parse(d.validUntil)) ||
      new Date(d.validUntil).toISOString().slice(0, 10) !== d.validUntil)
  )
    return 'invalidDraft';
  const details = d.documentDetails;
  for (const [key, val] of Object.entries(details)) {
    if (
      ![
        'consultant',
        'subjectAr',
        'included',
        'excluded',
        'notes',
        'preparedBy',
        'repPhone',
        'shopDrawingDays',
        'paymentSchedule',
        'formatVersion',
        'paymentPlan',
        'itemOptions',
        'commercialPreset',
        'knowledge',
        'referenceImage',
      ].includes(key)
    )
      return 'invalidDraft';
    if (val === undefined) continue;
    if (
      key !== 'knowledge' &&
      key !== 'referenceImage' &&
      key !== 'shopDrawingDays' &&
      key !== 'paymentSchedule' &&
      key !== 'formatVersion' &&
      key !== 'paymentPlan' &&
      key !== 'itemOptions' &&
      (typeof val !== 'string' || val.length > 10000)
    )
      return 'invalidDraft';
  }
  if (
    details.shopDrawingDays !== undefined &&
    (!finite(details.shopDrawingDays) ||
      details.shopDrawingDays < 0 ||
      !Number.isInteger(details.shopDrawingDays))
  )
    return 'invalidDraft';
  if (
    details.knowledge !== undefined &&
    !validQuotationKnowledge(details.knowledge)
  )
    return 'invalidDraft';
  if (
    details.referenceImage !== undefined &&
    !validReferenceImage(details.referenceImage)
  )
    return 'referenceImageInvalid';
  const ids = new Set<string>();
  const discountValid = (type: unknown, val: unknown, amount: number) =>
    (type === 'percent' || type === 'fixed') &&
    finite(val) &&
    val >= 0 &&
    val <= (type === 'percent' ? 100 : amount);
  for (const i of d.items) {
    if (
      !i ||
      typeof i.id !== 'string' ||
      !uuid.test(i.id) ||
      ids.has(i.id) ||
      !['line', 'section'].includes(i.itemType)
    )
      return 'invalidItem';
    ids.add(i.id);
    if (
      [
        'description',
        'descriptionAr',
        'itemCode',
        'specification',
        'unit',
        'measurementUnit',
        'kind',
      ].some(
        (k) =>
          i[k as keyof QuotationItemToSave] !== undefined &&
          (typeof i[k as keyof QuotationItemToSave] !== 'string' ||
            String(i[k as keyof QuotationItemToSave]).length > 10000)
      )
    )
      return 'invalidItem';
    if (i.productId && !uuid.test(i.productId)) return 'invalidItem';
    if (isNonChargeable(i) && (!i.parentItemId || i.discountValue))
      return 'invalidItem';
    if (
      i.unit === 'm2' &&
      i.measurementUnit !== undefined &&
      !['mm', 'cm', 'm'].includes(i.measurementUnit)
    )
      return 'invalidItem';
    if (i.itemType === 'line') {
      if (
        !finite(i.qty) ||
        i.qty <= 0 ||
        (i.unitPrice !== undefined &&
          (!finite(i.unitPrice) || i.unitPrice < 0)) ||
        [i.sizeW, i.sizeH].some((n) => n !== undefined && (!finite(n) || n < 0))
      )
        return 'invalidItem';
      if (
        !Number.isFinite(billableQuantity(i) * (i.unitPrice ?? 0)) ||
        billableQuantity(i) * (i.unitPrice ?? 0) > 1e12
      )
        return 'invalidItem';
      if (
        i.discountType &&
        !discountValid(
          i.discountType,
          i.discountValue ?? 0,
          billableQuantity(i) * (i.unitPrice ?? 0)
        )
      )
        return 'invalidDiscount';
    }
  }
  for (const i of d.items)
    if (i.parentItemId) {
      const parent = d.items.find((p) => p.id === i.parentItemId);
      if (
        !parent ||
        parent.parentItemId ||
        parent.itemType !== 'line' ||
        i.itemType !== 'line'
      )
        return 'invalidItem';
    }
  const subtotal = computeQuotationTotals(d.items).subtotal;
  if (
    d.orderDiscount &&
    !discountValid(
      d.orderDiscount.discountType,
      d.orderDiscount.discountValue,
      subtotal
    )
  )
    return 'invalidDiscount';
  if (
    details.paymentPlan !== undefined &&
    !validPaymentPlan(details.paymentPlan, forExport)
  )
    return 'invalidSchedule';
  if (
    details.itemOptions !== undefined &&
    (!details.itemOptions ||
      typeof details.itemOptions !== 'object' ||
      Array.isArray(details.itemOptions) ||
      Object.entries(details.itemOptions).some(
        ([id, o]) =>
          !uuid.test(id) ||
          !o ||
          typeof o !== 'object' ||
          Object.keys(o).some(
            (k) => !['drawingReference', 'selections'].includes(k)
          ) ||
          (o.drawingReference !== undefined &&
            (typeof o.drawingReference !== 'string' ||
              o.drawingReference.length > 1000)) ||
          (o.selections !== undefined &&
            (!o.selections ||
              typeof o.selections !== 'object' ||
              Array.isArray(o.selections) ||
              Object.entries(o.selections).some(
                ([k, v]) =>
                  k.length > 100 || typeof v !== 'string' || v.length > 1000
              )))
      ))
  )
    return 'invalidDraft';
  if (details.formatVersion !== undefined && details.formatVersion !== 2)
    return 'invalidDraft';
  if (details.paymentSchedule) {
    const vals = [
      details.paymentSchedule.advance,
      details.paymentSchedule.delivery,
      details.paymentSchedule.completion,
    ];
    if (
      details.paymentSchedule.deliveryTrigger !== undefined &&
      !['before_installation', 'on_delivery'].includes(
        details.paymentSchedule.deliveryTrigger
      )
    )
      return 'invalidSchedule';
    if (
      vals.some((v) => !finite(v) || v < 0 || v > 100) ||
      vals.reduce((a, b) => a + b, 0) > 100 + 1e-8 ||
      (forExport && Math.abs(vals.reduce((a, b) => a + b, 0) - 100) > 0.001)
    )
      return 'invalidSchedule';
  }
  if (forExport) {
    if (knowledgeExportError(d.items, details.knowledge))
      return 'staleKnowledgePrice';
    if (currency !== 'QAR') return 'unsupportedCurrency';
    if (!d.clientName.trim() && !d.clientCompany.trim())
      return 'customerRequired';
    if (!d.subject.trim()) return 'subjectRequired';
    const lines = d.items.filter(
      (i) => i.itemType === 'line' && !isNonChargeable(i)
    );
    if (!lines.length) return 'itemsRequired';
    if (
      d.items.some((i) => i.itemType === 'line' && !i.description?.trim()) ||
      lines.some((i) => i.unitPrice === undefined || (!!i.productId && !i.unit))
    )
      return 'priceRequired';
    if (
      d.items.some(
        (i) =>
          i.itemType === 'line' &&
          i.unit === 'm2' &&
          ((i.sizeW ?? 0) <= 0 || (i.sizeH ?? 0) <= 0)
      )
    )
      return 'areaDimensionsRequired';
    if (!d.validUntil) return 'validityRequired';
    if (
      d.items.some(
        (i) =>
          details.itemOptions?.[i.id]?.selections?.finish === 'Custom' &&
          !details.itemOptions[i.id].selections?.customFinish?.trim()
      )
    )
      return 'configurationRequired';
    if (
      details.formatVersion === 2 &&
      !details.paymentPlan &&
      !details.paymentSchedule
    )
      return 'invalidSchedule';
    if (
      !d.deliveryTerms.trim() ||
      (!d.paymentTerms.trim() &&
        !details.paymentSchedule &&
        !details.paymentPlan)
    )
      return 'termsRequired';
  }
  return null;
}
