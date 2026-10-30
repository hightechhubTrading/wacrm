import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { businessDateTimeValue } from '@/lib/business-time';
import { agendaDayEnd, loadAgenda } from './agenda';

function database(results: (object | Error)[]) {
  const calls: [string, string, unknown[]][] = [];
  let index = 0;
  const chain = (table: string) => {
    const result = results[index++];
    const query: Record<string, unknown> = {
      then(
        resolve: (value: object) => unknown,
        reject: (error: unknown) => unknown
      ) {
        return (
          result instanceof Error
            ? Promise.reject(result)
            : Promise.resolve(result)
        ).then(resolve, reject);
      },
    };
    for (const method of ['select', 'eq', 'in', 'lt', 'or', 'order', 'limit'])
      query[method] = vi.fn((...args: unknown[]) => {
        calls.push([table, method, args]);
        return query;
      });
    return query;
  };
  const db = {
    from: chain,
    rpc(name: string, args: unknown) {
      calls.push([name, 'rpc', [args]]);
      return chain(name);
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}
const empty = (): object[] => [
  { data: { items: [], count: 0 }, error: null },
  { data: [], count: 0, error: null },
  { data: [], count: 0, error: null },
  { data: [], count: 0, error: null },
  { data: [], error: null },
];
describe('sales Today loader', () => {
  it('loads exact reply counts without using unread counts, and scopes every list', async () => {
    const results = empty();
    results[0] = {
      data: { items: [{ id: 'read-but-unanswered' }], count: 12 },
      error: null,
    };
    const { db, calls } = database(results);
    const data = await loadAgenda(db, 'account', 'user');
    expect(data.replies.map((c) => c.id)).toEqual(['read-but-unanswered']);
    expect(data.replyCount).toBe(12);
    expect(data.repliesAvailable).toBe(true);
    expect(calls).toContainEqual([
      'sales_today_replies',
      'rpc',
      [{ p_account: 'account' }],
    ]);
    expect(
      calls.filter(
        ([, method, args]) => method === 'eq' && args[0] === 'account_id'
      )
    ).toHaveLength(4);
    expect(calls.some(([, , args]) => args.includes('unread_count'))).toBe(
      false
    );
  });
  it('includes only due-through-today follow-ups owned by this user or unassigned', async () => {
    const now = new Date(2026, 9, 29, 12, 30);
    const { db, calls } = database(empty());
    await loadAgenda(db, 'account', 'user', now);
    expect(calls).toContainEqual([
      'ai_followups',
      'or',
      ['owner_id.eq.user,owner_id.is.null'],
    ]);
    expect(calls).toContainEqual([
      'ai_followups',
      'lt',
      ['due_at', '2026-10-29T21:00:00.000Z'],
    ]);
    expect(calls).toContainEqual([
      'ai_followups',
      'in',
      ['conversation.status', ['open', 'pending']],
    ]);
    expect(calls).toContainEqual([
      'ai_followups',
      'in',
      ['status', ['open', 'acknowledged', 'deferred']],
    ]);
  });
  it('keeps blocked work separate and excludes prepared and completed work from waiting', async () => {
    const { db, calls } = database(empty());
    await loadAgenda(db, 'account', 'user');
    expect(calls).toContainEqual([
      'group_handoffs',
      'in',
      ['status', ['waiting', 'in_progress', 'ready']],
    ]);
    expect(calls).toContainEqual([
      'group_handoffs',
      'eq',
      ['status', 'blocked'],
    ]);
    expect(
      calls.filter(
        ([table, method, args]) =>
          table === 'group_handoffs' &&
          method === 'select' &&
          String(args[0]).includes('deals!inner')
      )
    ).toHaveLength(2);
    expect(
      calls.filter(([, method, args]) => method === 'limit' && args[0] === 6)
    ).toHaveLength(4);
  });
  it.each([0, 1, 2, 3])(
    'keeps section %i unavailable independently of the others',
    async (index) => {
      const results: (object | Error)[] = empty();
      results[index] = {
        data: null,
        error: { message: 'Missing table or RPC' },
      };
      const { db } = database(results);
      const data = await loadAgenda(db, 'account', 'user');
      const availability = [
        data.repliesAvailable,
        data.tasksAvailable,
        data.waitingAvailable,
        data.blockedAvailable,
      ];
      expect(availability).toEqual([0, 1, 2, 3].map((i) => i !== index));
    }
  );
  it('isolates a thrown network failure too', async () => {
    const results: (object | Error)[] = empty();
    results[2] = new Error('offline');
    const { db } = database(results);
    const data = await loadAgenda(db, 'account', 'user');
    expect(data.waitingAvailable).toBe(false);
    expect(data.blockedAvailable).toBe(true);
    expect(data.repliesAvailable).toBe(true);
  });
  it('uses the next Qatar calendar midnight without mutating the input', () => {
    for (const date of [
      new Date(2026, 9, 29, 23, 59, 59),
      new Date(2026, 2, 29, 1),
      new Date(2026, 9, 25, 1),
    ]) {
      const original = date.getTime();
      const end = new Date(agendaDayEnd(date));
      expect(businessDateTimeValue(end).slice(11)).toBe('00:00');
      expect(end.getTime()).toBeGreaterThan(date.getTime());
      expect(end.getTime() - date.getTime()).toBeLessThanOrEqual(
        24 * 60 * 60 * 1000
      );
      expect(date.getTime()).toBe(original);
    }
  });
});
