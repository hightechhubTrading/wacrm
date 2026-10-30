import { formatBusinessDate } from '@/lib/business-time';
export type WorkKind = 'measurement' | 'workshop';
export type WorkStatus =
  | 'draft'
  | 'waiting'
  | 'in_progress'
  | 'report_received'
  | 'ready'
  | 'installed'
  | 'blocked'
  | 'cancelled';
export type WorkAction =
  | 'posted'
  | 'started'
  | 'report'
  | 'ready'
  | 'installed'
  | 'blocked'
  | 'cancelled'
  | 'update';
export interface WorkAttachment {
  path: string;
  name: string;
  size: number;
  url?: string;
}
export interface WorkEvent {
  id: string;
  action: string;
  status: WorkStatus;
  note: string;
  attachments: WorkAttachment[];
  created_at: string;
}
export interface QuotationSnapshot {
  reference: string;
  revision: number;
  items: {
    description: string | null;
    description_ar: string | null;
    size_w: number | null;
    size_h: number | null;
    qty: number | null;
  }[];
}
export interface GroupWork {
  id: string;
  deal_id: string;
  reference: number;
  kind: WorkKind;
  status: WorkStatus;
  location: string;
  details: string;
  responsible: string | null;
  due_at: string | null;
  revision: number;
  updated_at: string;
  quotation_snapshot: QuotationSnapshot | null;
}
export function nextStatus(
  work: Pick<GroupWork, 'kind' | 'status'>,
  action: WorkAction
): WorkStatus | null {
  const { kind, status } = work;
  if (['report_received', 'installed', 'cancelled'].includes(status))
    return null;
  if (action === 'cancelled') return 'cancelled';
  if (action === 'posted' && status === 'draft') return 'waiting';
  if (action === 'update' && status !== 'draft') return status;
  if (action === 'started' && ['waiting', 'blocked'].includes(status))
    return 'in_progress';
  if (action === 'report' && kind === 'measurement' && status !== 'draft')
    return 'report_received';
  if (
    action === 'ready' &&
    kind === 'workshop' &&
    ['waiting', 'in_progress', 'blocked'].includes(status)
  )
    return 'ready';
  if (action === 'installed' && kind === 'workshop' && status === 'ready')
    return 'installed';
  if (
    action === 'blocked' &&
    ['waiting', 'in_progress', 'ready'].includes(status)
  )
    return 'blocked';
  return null;
}
export function needsEvidence(action: WorkAction) {
  return ['report', 'ready', 'installed', 'blocked', 'cancelled'].includes(
    action
  );
}
export function groupMessage(
  work: GroupWork,
  customer: { name?: string | null; phone?: string | null },
  locale = 'en'
): string {
  const ar = locale === 'ar';
  const lines = [
    `${ar ? 'مرجع العمل' : 'Job reference'}: HTH-${work.reference}`,
    ar
      ? work.kind === 'measurement'
        ? 'طلب زيارة وقياس'
        : 'طلب تصنيع'
      : work.kind === 'measurement'
        ? 'Measurement visit request'
        : 'Workshop request',
    `${ar ? 'العميل' : 'Customer'}: ${customer.name || customer.phone || '—'}`,
    `${ar ? 'الهاتف' : 'Phone'}: ${customer.phone || '—'}`,
    `${ar ? 'الموقع' : 'Location'}: ${work.location}`,
    work.details,
  ];
  if (work.responsible)
    lines.push(`${ar ? 'المسؤول' : 'Responsible'}: ${work.responsible}`);
  if (work.due_at)
    lines.push(
      `${ar ? 'التاريخ المطلوب (غير مؤكد)' : 'Requested date (unconfirmed)'}: ${formatBusinessDate(work.due_at, ar ? 'ar-QA' : 'en-QA')} (${ar ? 'توقيت قطر' : 'Qatar time'})`
    );
  const q = work.quotation_snapshot;
  if (q) {
    lines.push(
      `${ar ? 'العرض المعتمد' : 'Accepted quotation'}: ${q.reference} / rev ${q.revision}`
    );
    for (const item of q.items) {
      lines.push(
        `${ar ? item.description_ar || item.description : item.description || item.description_ar} | ${item.size_w ?? '—'} × ${item.size_h ?? '—'} | ${ar ? 'العدد' : 'Qty'}: ${item.qty ?? '—'}`
      );
    }
    lines.push(
      ar
        ? 'أرفق النسخة المعتمدة من العرض والمخططات. الوحدات والمواصفات حسب المستندات المعتمدة.'
        : 'Attach the accepted quotation and drawings. Units and specifications follow the approved documents.'
    );
  }
  lines.push(
    ar
      ? 'يرجى ذكر مرجع العمل في الرد وإرسال التقرير أو تحديث الحالة إلى مندوب المبيعات.'
      : 'Please include the job reference in your reply and send the report or status update to sales.'
  );
  return lines.join('\n');
}
export function workInput(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== 'measurement' && b.kind !== 'workshop') return null;
  if (
    typeof b.location !== 'string' ||
    !b.location.trim() ||
    b.location.length > 1000
  )
    return null;
  if (
    typeof b.details !== 'string' ||
    b.details.trim().length < 10 ||
    b.details.length > 10000
  )
    return null;
  if (
    b.responsible != null &&
    (typeof b.responsible !== 'string' || b.responsible.length > 200)
  )
    return null;
  if (
    b.due_at != null &&
    (typeof b.due_at !== 'string' ||
      !Number.isFinite(Date.parse(b.due_at)) ||
      Date.parse(b.due_at) <= Date.now())
  )
    return null;
  return {
    kind: b.kind,
    location: b.location.trim(),
    details: b.details.trim(),
    responsible:
      typeof b.responsible === 'string' ? b.responsible.trim() || null : null,
    due_at:
      typeof b.due_at === 'string' ? new Date(b.due_at).toISOString() : null,
  };
}
