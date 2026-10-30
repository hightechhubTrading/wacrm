import { businessDayEnd } from '@/lib/business-time';
export type SalesView =
  | 'needs_reply'
  | 'followup_today'
  | 'waiting_customer'
  | 'waiting_measurement'
  | 'waiting_workshop';
export const SALES_VIEWS: SalesView[] = [
  'needs_reply',
  'followup_today',
  'waiting_customer',
  'waiting_measurement',
  'waiting_workshop',
];
export interface SalesContext {
  conversation_id: string;
  last_sender: 'customer' | 'agent' | 'bot' | null;
  followups: {
    id: string;
    kind: string;
    due_at: string;
    owner_id: string | null;
    owner_name?: string | null;
  }[];
  work: {
    id: string;
    deal_id: string;
    reference: number;
    kind: 'measurement' | 'workshop';
    status: string;
    due_at: string | null;
    responsible: string | null;
  }[];
}
export function matchesSalesView(
  view: SalesView,
  ctx: SalesContext | undefined,
  status: string,
  userId: string | undefined,
  now = new Date()
): boolean {
  if (!ctx || status === 'closed') return false;
  const end = businessDayEnd(new Date(now));
  switch (view) {
    case 'needs_reply':
      return ctx.last_sender === 'customer';
    case 'waiting_customer':
      return (
        (ctx.last_sender === 'agent' || ctx.last_sender === 'bot') &&
        !ctx.work.length &&
        !ctx.followups.length
      );
    case 'waiting_measurement':
      return ctx.work.some(
        (w) => w.kind === 'measurement' && w.status !== 'draft'
      );
    case 'waiting_workshop':
      return ctx.work.some(
        (w) => w.kind === 'workshop' && w.status !== 'draft'
      );
    case 'followup_today':
      return (
        ctx.followups.some(
          (f) =>
            (!f.owner_id || f.owner_id === userId) &&
            Date.parse(f.due_at) <= end.getTime()
        ) ||
        ctx.work.some((w) => w.due_at && Date.parse(w.due_at) <= end.getTime())
      );
  }
}
export type SalesAction =
  | { kind: 'closed' }
  | { kind: 'reply' }
  | { kind: 'waiting' }
  | { kind: 'none' }
  | { kind: 'followup'; task: SalesContext['followups'][number] }
  | { kind: 'work'; work: SalesContext['work'][number] };
export function nextSalesAction(
  ctx: SalesContext,
  status: string,
  now = Date.now()
): SalesAction {
  if (status === 'closed') return { kind: 'closed' as const };
  if (ctx.last_sender === 'customer') return { kind: 'reply' as const };
  const task = [...ctx.followups].sort(
    (a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)
  )[0];
  if (task && Date.parse(task.due_at) <= now)
    return { kind: 'followup' as const, task };
  const work = [...ctx.work].sort(
    (a, b) =>
      (a.status === 'blocked' ? -1 : 0) - (b.status === 'blocked' ? -1 : 0) ||
      (a.due_at ? Date.parse(a.due_at) : Infinity) -
        (b.due_at ? Date.parse(b.due_at) : Infinity)
  )[0];
  if (work) return { kind: 'work' as const, work };
  if (task) return { kind: 'followup' as const, task };
  return { kind: ctx.last_sender ? ('waiting' as const) : ('none' as const) };
}
