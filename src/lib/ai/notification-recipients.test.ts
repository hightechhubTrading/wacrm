import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { resolveNotificationRecipients } from './notification-recipients';

const members = [
  { user_id: 'admin-a', account_id: 'a', account_role: 'admin' },
  { user_id: 'owner-a', account_id: 'a', account_role: 'owner' },
  { user_id: 'agent-a', account_id: 'a', account_role: 'agent' },
  { user_id: 'viewer-a', account_id: 'a', account_role: 'viewer' },
  { user_id: 'removed-agent', account_id: 'personal', account_role: 'owner' },
  { user_id: 'admin-b', account_id: 'b', account_role: 'admin' },
];
function database(error: unknown = null) {
  return {
    from: () => {
      const predicates: ((row: Record<string, string>) => boolean)[] = [];
      const result = () => ({ data: members.filter((row) => predicates.every((test) => test(row))), error });
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { predicates.push((row) => row[key] === value); return query; },
        in: (key: string, values: string[]) => { predicates.push((row) => values.includes(row[key])); return query; },
        maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}
describe('notification membership', () => {
  it('resolves only the current assigned member', async () => {
    expect(await resolveNotificationRecipients(database(), 'a', 'agent-a')).toEqual(['agent-a']);
  });
  it.each(['removed-agent', 'admin-b', 'viewer-a', 'missing', null])('falls back to same-account admins for %s', async (savedRecipient) => {
    expect(await resolveNotificationRecipients(database(), 'a', savedRecipient)).toEqual(['admin-a', 'owner-a']);
  });
  it('fails closed when membership cannot be established', async () => {
    expect(await resolveNotificationRecipients(database({ message: 'dummy failure' }), 'a', 'agent-a')).toEqual([]);
  });
});
