import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAgenda } from './agenda';
const conversation = (id: string, extra = {}) => ({
  id,
  status: 'open',
  unread_count: 1,
  contact: null,
  ...extra,
});
function database(results: object[]) {
  const calls: [string, string, unknown[]][] = [];
  let index = 0;
  const db = {
    from(table: string) {
      const result = results[index++];
      const chain: Record<string, unknown> = {
        then(resolve: (value: object) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };
      for (const method of [
        'select',
        'eq',
        'neq',
        'in',
        'gt',
        'or',
        'order',
        'limit',
      ])
        chain[method] = vi.fn((...args: unknown[]) => {
          calls.push([table, method, args]);
          return chain;
        });
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}
describe('agenda loader', () => {
  it('deduplicates attention results and keeps exact counts separate', async () => {
    const priority = conversation('priority', { ai_priority: 'urgent' });
    const { db, calls } = database([
      { data: [priority], count: 12 },
      { data: [priority, conversation('unread')], count: 24 },
      { data: [], count: 18, error: null },
      { data: [{ user_id: 'u', full_name: 'Alex' }] },
    ]);
    const result = await loadAgenda(db, 'account', 'user');
    expect(result.conversations.map((c) => c.id)).toEqual([
      'priority',
      'unread',
    ]);
    expect(result.priorityCount).toBe(12);
    expect(result.unreadCount).toBe(24);
    expect(result.tasksAvailable).toBe(true);
    expect(result.taskCount).toBe(18);
    expect(result.tasks).toHaveLength(0);
    expect(
      calls.filter(
        ([, method, args]) => method === 'eq' && args[0] === 'account_id'
      )
    ).toHaveLength(4);
    expect(calls).toContainEqual([
      'ai_followups',
      'or',
      ['owner_id.eq.user,owner_id.is.null'],
    ]);
    expect(calls).toContainEqual([
      'ai_followups',
      'in',
      ['conversation.status', ['open', 'pending']],
    ]);
  });
  it('distinguishes an unavailable follow-up table from a successfully empty agenda', async () => {
    const { db } = database([
      { data: [], count: 0 },
      { data: [], count: 0 },
      { data: null, error: { code: '42P01' } },
      { data: [], error: null },
    ]);
    const result = await loadAgenda(db, 'account', 'user');
    expect(result.tasksAvailable).toBe(false);
    expect(result.attentionAvailable).toBe(true);
  });
  it('reports a partially failed attention query as unavailable', async () => {
    const { db } = database([
      { data: null, error: { message: 'offline' } },
      { data: [], count: 0 },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    expect((await loadAgenda(db, 'account', 'user')).attentionAvailable).toBe(
      false
    );
  });
});
