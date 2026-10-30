import { expect, it } from 'vitest';
import {
  jobHistory,
  latestMeasurement,
  nextJobWork,
  type OverviewWork,
} from './job-overview';
import type { Quotation } from '@/lib/quotations/types';
const work = (
  id: string,
  status: OverviewWork['status'] = 'waiting'
): OverviewWork => ({
  id,
  deal_id: 'job',
  reference: 42,
  kind: 'measurement',
  status,
  location: '',
  details: '',
  responsible: null,
  due_at: null,
  revision: 1,
  updated_at: '2026-10-30T11:00:00Z',
  quotation_snapshot: null,
});
it('orders recorded source events across modules without inventing acceptance timestamps', () => {
  const report = {
    ...work('measurement', 'report_received'),
    created_at: '2026-10-28T08:00:00Z',
    events: [
      {
        id: 'report',
        created_at: '2026-10-30T10:00:00Z',
        action: 'report',
        status: 'report_received' as const,
        note: 'Forwarded measurement',
      },
    ],
  };
  const quote = {
    id: 'quotation',
    createdAt: '2026-10-29T08:00:00Z',
    updatedAt: '2026-10-30T12:00:00Z',
    status: 'won',
  } as Quotation;
  const history = jobHistory([report], [quote]);
  expect(history.map((entry) => [entry.id, entry.at])).toEqual([
    ['event:report', '2026-10-30T10:00:00Z'],
    ['quote:quotation', '2026-10-29T08:00:00Z'],
    ['work:measurement', '2026-10-28T08:00:00Z'],
  ]);
  expect(latestMeasurement([report])?.event.note).toBe('Forwarded measurement');
});
it('bounds recent history and ignores unknown dates rather than labeling them today', () => {
  const quotes = Array.from(
    { length: 25 },
    (_, i) =>
      ({
        id: String(i),
        createdAt:
          i === 0 ? 'invalid' : new Date(Date.UTC(2026, 9, i)).toISOString(),
      }) as Quotation
  );
  const history = jobHistory([], quotes);
  expect(history).toHaveLength(20);
  expect(history.every((entry) => entry.id !== 'quote:0')).toBe(true);
  expect(history[0].id).toBe('quote:24');
});
it('prioritizes an active blocker and excludes terminal work from the next action', () => {
  expect(
    nextJobWork([
      work('complete', 'report_received'),
      work('waiting'),
      work('blocker', 'blocked'),
    ])?.id
  ).toBe('blocker');
  expect(nextJobWork([work('complete', 'installed')])).toBeNull();
});
