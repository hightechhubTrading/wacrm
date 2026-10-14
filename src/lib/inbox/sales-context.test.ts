import { describe, it, expect } from 'vitest';
import {
  matchesSalesView,
  nextSalesAction,
  type SalesContext,
} from './sales-context';
const empty: SalesContext = {
  conversation_id: 'c',
  last_sender: null,
  followups: [],
  work: [],
};
const work: SalesContext['work'][number] = {
  id: 'w',
  deal_id: 'd',
  reference: 42,
  kind: 'measurement',
  status: 'waiting',
  due_at: null,
  responsible: 'Team',
};
describe('sales inbox facts', () => {
  it('finds unanswered customer messages even after unread counts are cleared', () =>
    expect(
      matchesSalesView(
        'needs_reply',
        { ...empty, last_sender: 'customer' },
        'open',
        'user'
      )
    ).toBe(true));
  it('does not treat unread outgoing messages as unanswered customer messages', () =>
    expect(
      matchesSalesView(
        'needs_reply',
        { ...empty, last_sender: 'agent' },
        'open',
        'user'
      )
    ).toBe(false));
  it('keeps closed conversations out of all sales queues', () => {
    for (const view of [
      'needs_reply',
      'followup_today',
      'waiting_customer',
      'waiting_measurement',
      'waiting_workshop',
    ] as const)
      expect(
        matchesSalesView(
          view,
          { ...empty, last_sender: 'customer', work: [work] },
          'closed',
          'user'
        )
      ).toBe(false);
  });
  it('does not mistake a draft request for work already posted in a group', () =>
    expect(
      matchesSalesView(
        'waiting_measurement',
        { ...empty, work: [{ ...work, status: 'draft' }] },
        'open',
        'user'
      )
    ).toBe(false));
  it('shows recorded measurement work and workshop work separately', () => {
    expect(
      matchesSalesView(
        'waiting_measurement',
        { ...empty, work: [work] },
        'open',
        'user'
      )
    ).toBe(true);
    expect(
      matchesSalesView(
        'waiting_workshop',
        { ...empty, work: [work] },
        'open',
        'user'
      )
    ).toBe(false);
  });
  it('does not label external work as waiting for the customer', () =>
    expect(
      matchesSalesView(
        'waiting_customer',
        { ...empty, last_sender: 'agent', work: [work] },
        'open',
        'user'
      )
    ).toBe(false));
  it('includes overdue and today tasks, excludes another salesperson’s task', () => {
    const now = new Date('2026-10-13T12:00:00');
    const task = {
      id: 'f',
      kind: 'quotation',
      due_at: new Date('2026-10-13T14:00:00').toISOString(),
      owner_id: 'user',
    };
    expect(
      matchesSalesView(
        'followup_today',
        { ...empty, followups: [task] },
        'open',
        'user',
        now
      )
    ).toBe(true);
    expect(
      matchesSalesView(
        'followup_today',
        { ...empty, followups: [{ ...task, owner_id: 'other' }] },
        'open',
        'user',
        now
      )
    ).toBe(false);
  });
  it('prioritizes a customer reply over pending work', () =>
    expect(
      nextSalesAction(
        { ...empty, last_sender: 'customer', work: [work] },
        'open'
      ).kind
    ).toBe('reply'));
  it('prioritizes an overdue follow-up over waiting work', () =>
    expect(
      nextSalesAction(
        {
          ...empty,
          work: [work],
          followups: [
            {
              id: 'f',
              kind: 'quotation',
              due_at: '2000-01-01',
              owner_id: null,
            },
          ],
        },
        'open'
      ).kind
    ).toBe('followup'));
  it('surfaces blocked work before work without a due date', () => {
    const result = nextSalesAction(
      { ...empty, work: [work, { ...work, id: 'blocked', status: 'blocked' }] },
      'open'
    );
    expect(result.kind === 'work' && result.work.id).toBe('blocked');
  });
});
