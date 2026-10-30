import type { GroupWork, WorkEvent } from '@/lib/jobs/workflow';
import type { Quotation } from '@/lib/quotations/types';

export type OverviewWork = GroupWork & {
  created_at?: string;
  events?: Pick<
    WorkEvent,
    'id' | 'action' | 'status' | 'note' | 'created_at'
  >[];
};
export type JobHistoryEntry =
  | { id: string; at: string; kind: 'quotation'; quote: Quotation }
  | {
      id: string;
      at: string;
      kind: 'work';
      work: OverviewWork;
      event?: NonNullable<OverviewWork['events']>[number];
    };
/** Recorded timestamps only: current quotation status is not a dated acceptance event. */
export function jobHistory(
  work: OverviewWork[],
  quotes: Quotation[]
): JobHistoryEntry[] {
  const entries: JobHistoryEntry[] = quotes.map((quote) => ({
    id: `quote:${quote.id}`,
    at: quote.createdAt,
    kind: 'quotation',
    quote,
  }));
  for (const item of work) {
    if (item.created_at)
      entries.push({
        id: `work:${item.id}`,
        at: item.created_at,
        kind: 'work',
        work: item,
      });
    for (const event of item.events ?? [])
      entries.push({
        id: `event:${event.id}`,
        at: event.created_at,
        kind: 'work',
        work: item,
        event,
      });
  }
  return entries
    .filter((item) => Number.isFinite(Date.parse(item.at)))
    .sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)
    )
    .slice(0, 20);
}
export function latestMeasurement(work: OverviewWork[]) {
  return (
    work
      .filter((item) => item.kind === 'measurement')
      .flatMap((item) =>
        (item.events ?? [])
          .filter((event) => event.action === 'report')
          .map((event) => ({ work: item, event }))
      )
      .sort(
        (a, b) =>
          Date.parse(b.event.created_at) - Date.parse(a.event.created_at)
      )[0] ?? null
  );
}
export function nextJobWork(work: OverviewWork[]) {
  const active = work.filter(
    (item) =>
      !['report_received', 'installed', 'cancelled'].includes(item.status)
  );
  return active.find((item) => item.status === 'blocked') ?? active[0] ?? null;
}
