import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remindDueFollowups } from './followup-reminders';
const now = new Date('2026-10-12T12:00:00Z');
function query(data: unknown) {
  const chain = {
    select: () => chain,
    eq: vi.fn(() => chain),
    in: () => chain,
    lte: () => chain,
    order: () => chain,
    update: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    limit: () => Promise.resolve({ data, error: null }),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
  };
  return chain;
}
const task = {
  id: 'task',
  account_id: 'a',
  conversation_id: 'c',
  owner_id: 'old-owner',
  kind: 'repair',
  next_reminder_at: '2026-10-11T12:00:00Z',
};
describe('staff follow-up reminders', () => {
  it('does not double-notify a task whose due reminder has already been claimed', async () => {
    const due = query([task]),
      claim = query(null);
    const from = vi.fn().mockReturnValueOnce(due).mockReturnValueOnce(claim);
    expect(
      await remindDueFollowups({ from } as unknown as SupabaseClient, now)
    ).toBe(0);
    expect(from).toHaveBeenCalledTimes(2);
    expect(claim.eq).toHaveBeenCalledWith(
      'next_reminder_at',
      task.next_reminder_at
    );
  });
  it('notifies the current assignee and schedules the next daily reminder', async () => {
    const due = query([task]),
      claim = query({ id: 'task' }),
      conv = query({ assigned_agent_id: 'new-owner', contact_id: 'contact' }),
      member = query({ user_id: 'new-owner' }),
      fresh = query({ status: 'open', due_at: '2026-10-11T00:00:00Z' }),
      notice = query(null),
      finish = query(null);
    const from = vi.fn();
    for (const q of [due, claim, conv, member, fresh, notice, finish])
      from.mockReturnValueOnce(q);
    expect(
      await remindDueFollowups({ from } as unknown as SupabaseClient, now)
    ).toBe(1);
    expect(notice.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: 'new-owner',
        account_id: 'a',
        conversation_id: 'c',
      }),
    ]);
    expect(finish.update).toHaveBeenCalledWith({
      next_reminder_at: '2026-10-13T12:00:00.000Z',
    });
  });
  it('suppresses reminders when the customer defers while reminder processing is in flight', async () => {
    const from = vi.fn();
    for (const q of [
      query([task]),
      query({ id: 'task' }),
      query({ assigned_agent_id: 'owner', contact_id: 'contact' }),
      query({ user_id: 'owner' }),
      query({ status: 'deferred', due_at: '2026-11-01T00:00:00Z' }),
    ])
      from.mockReturnValueOnce(q);
    expect(
      await remindDueFollowups({ from } as unknown as SupabaseClient, now)
    ).toBe(0);
    expect(from).toHaveBeenCalledTimes(5);
  });
});
