import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { requireConversationScope } from './conversation-scope';

const scope = { conversationId: 'conversation-a', accountId: 'account-a', contactId: 'contact-a' };
function database(row: Record<string, string> | null, error: unknown = null) {
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { filters[key] = value; return query; },
    maybeSingle: async () => ({
      data: row && Object.entries(filters).every(([key, value]) => row[key] === value) ? row : null,
      error,
    }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}
describe('service sender conversation scope', () => {
  it('accepts the matching conversation, account and contact', async () => {
    await expect(requireConversationScope(database({ id: scope.conversationId, account_id: scope.accountId, contact_id: scope.contactId }), scope)).resolves.toBeUndefined();
  });
  it.each([
    { id: 'conversation-a', account_id: 'account-b', contact_id: 'contact-a' },
    { id: 'conversation-a', account_id: 'account-a', contact_id: 'contact-b' },
    { id: 'conversation-b', account_id: 'account-a', contact_id: 'contact-a' },
    null,
  ])('rejects a foreign or missing relationship %p', async (row) => {
    await expect(requireConversationScope(database(row), scope)).rejects.toThrow(/conversation not found/);
  });
  it('fails closed on lookup failure', async () => {
    await expect(requireConversationScope(database(null, { message: 'dummy lookup failure' }), scope)).rejects.toThrow();
  });
});
