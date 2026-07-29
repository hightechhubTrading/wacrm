// src/lib/contacts/find-or-create.test.ts
import { describe, it, expect, vi } from 'vitest';
import { findOrCreateContact, findOrCreateConversation } from './find-or-create';

function makeDb(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      calls.push({ table });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        like: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(overrides[`${table}.limit`] ?? { data: [], error: null }),
        insert: (row: Record<string, unknown>) => {
          calls.push({ table, insert: row });
          return builder;
        },
        update: () => builder,
        single: () => Promise.resolve(overrides[`${table}.single`] ?? { data: null, error: null }),
      };
      return builder;
    },
  };
  return { db: db as unknown as import('@supabase/supabase-js').SupabaseClient, calls };
}

describe('findOrCreateContact', () => {
  it('creates a new contact when none exists', async () => {
    const { db } = makeDb({
      'contacts.limit': { data: [], error: null }, // findExistingContact's .like() query
      'contacts.single': {
        data: { id: 'contact-1', phone: '+15551234567', name: 'Jane' },
        error: null,
      },
    });

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'owner-1',
      '+15551234567',
      'Jane',
    );

    expect(result).not.toBeNull();
    expect(result!.wasCreated).toBe(true);
    expect(result!.contact.id).toBe('contact-1');
  });
});

describe('findOrCreateConversation', () => {
  it('creates a new conversation when none exists', async () => {
    const { db } = makeDb({
      'conversations.limit': { data: [], error: null },
      'conversations.single': {
        data: { id: 'conv-1', contact_id: 'contact-1' },
        error: null,
      },
    });

    const result = await findOrCreateConversation(db, 'acct-1', 'owner-1', 'contact-1');

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.conversation.id).toBe('conv-1');
  });
});
