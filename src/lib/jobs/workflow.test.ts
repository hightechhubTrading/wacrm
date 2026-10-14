import { describe, it, expect } from 'vitest';
import {
  nextStatus,
  workInput,
  groupMessage,
  type GroupWork,
} from './workflow';
describe('WhatsApp group workflow', () => {
  it('requires sales to record posting before work can start', () => {
    expect(
      nextStatus({ kind: 'measurement', status: 'draft' }, 'started')
    ).toBeNull();
    expect(nextStatus({ kind: 'measurement', status: 'draft' }, 'posted')).toBe(
      'waiting'
    );
  });
  it('does not allow installation before workshop readiness', () => {
    expect(
      nextStatus({ kind: 'workshop', status: 'waiting' }, 'installed')
    ).toBeNull();
    expect(nextStatus({ kind: 'workshop', status: 'ready' }, 'installed')).toBe(
      'installed'
    );
  });
  it('accepts a measurement report but cannot install a visit', () => {
    expect(
      nextStatus({ kind: 'measurement', status: 'waiting' }, 'report')
    ).toBe('report_received');
    expect(
      nextStatus({ kind: 'measurement', status: 'waiting' }, 'ready')
    ).toBeNull();
  });
  it.each(['report_received', 'installed', 'cancelled'] as const)(
    'keeps %s history closed',
    (status) =>
      expect(nextStatus({ kind: 'workshop', status }, 'update')).toBeNull()
  );
  it('allows explicit blocking and resumption', () => {
    expect(
      nextStatus({ kind: 'workshop', status: 'in_progress' }, 'blocked')
    ).toBe('blocked');
    expect(nextStatus({ kind: 'workshop', status: 'blocked' }, 'started')).toBe(
      'in_progress'
    );
  });
  it('does not fabricate a scheduled visit', () => {
    const w = {
      reference: 42,
      kind: 'measurement',
      location: 'Doha',
      details: 'Two shutters',
      due_at: '2026-11-01T12:00:00Z',
    } as GroupWork;
    expect(groupMessage(w, { name: 'Customer' })).toContain(
      'Requested date (unconfirmed)'
    );
    expect(groupMessage(w, {}, 'ar')).toContain('غير مؤكد');
  });
  it('uses the accepted revision and preserves quantities and dimensions', () => {
    const w = {
      reference: 42,
      kind: 'workshop',
      location: 'Doha',
      details: 'Blue',
      quotation_snapshot: {
        reference: 'Q-12',
        revision: 3,
        items: [
          {
            description: 'Five shutters',
            description_ar: null,
            size_w: 2,
            size_h: 3,
            qty: 5,
          },
        ],
      },
    } as GroupWork;
    const text = groupMessage(w, {});
    expect(text).toContain('Q-12 / rev 3');
    expect(text).toContain('2 × 3 | Qty: 5');
    expect(text).toContain('Attach the accepted quotation');
  });
  it('rejects missing requirements, invalid kinds and past requested dates', () => {
    expect(
      workInput({
        kind: 'other',
        location: 'Doha',
        details: 'Long enough detail',
      })
    ).toBeNull();
    expect(
      workInput({
        kind: 'measurement',
        location: '',
        details: 'Long enough detail',
      })
    ).toBeNull();
    expect(
      workInput({
        kind: 'measurement',
        location: 'Doha',
        details: 'Long enough detail',
        due_at: '2000-01-01',
      })
    ).toBeNull();
  });
});
