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
        // dedupe.ts's findExistingContact terminates its query chain at
        // `.like(...)` and awaits that call directly (it never calls
        // `.limit()` for the contacts table) — so this must resolve to
        // { data, error } itself, matching the real chain, rather than
        // returning the builder for further chaining.
        like: () => Promise.resolve(overrides[`${table}.like`] ?? { data: [], error: null }),
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
      'contacts.like': { data: [], error: null }, // findExistingContact's .like() query — no match, so it falls through to insert
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

  it('omits assigned_agent_id entirely when no agent is passed (Meta webhook)', async () => {
    const { db, calls } = makeDb({
      'conversations.limit': { data: [], error: null },
      'conversations.single': { data: { id: 'conv-1' }, error: null },
    });

    await findOrCreateConversation(db, 'acct-1', 'owner-1', 'contact-1');

    const insert = calls.find(
      (c) => c.table === 'conversations' && c.insert,
    )!.insert as Record<string, unknown>;
    // Absent, not null — the column keeps its NULL default and the
    // conversation stays unassigned exactly as before.
    expect('assigned_agent_id' in insert).toBe(false);
  });

  it('assigns the given agent when it CREATES the conversation', async () => {
    const { db, calls } = makeDb({
      'conversations.limit': { data: [], error: null },
      'conversations.single': { data: { id: 'conv-1' }, error: null },
    });

    const result = await findOrCreateConversation(
      db,
      'acct-1',
      'owner-1',
      'contact-1',
      'agent-user-1',
    );

    expect(result!.created).toBe(true);
    const insert = calls.find(
      (c) => c.table === 'conversations' && c.insert,
    )!.insert as Record<string, unknown>;
    expect(insert.assigned_agent_id).toBe('agent-user-1');
  });

  it('never touches assigned_agent_id on an EXISTING conversation', async () => {
    // No retroactive handoff: a customer messaging an agent's WAHA
    // number must not pull an already-owned conversation away from
    // whoever holds it.
    const existing = {
      id: 'conv-existing',
      contact_id: 'contact-1',
      assigned_agent_id: 'someone-else',
    };
    const { db, calls } = makeDb({
      'conversations.limit': { data: [existing], error: null },
    });

    const result = await findOrCreateConversation(
      db,
      'acct-1',
      'owner-1',
      'contact-1',
      'agent-user-1',
    );

    expect(result!.created).toBe(false);
    expect(result!.conversation.assigned_agent_id).toBe('someone-else');
    expect(calls.some((c) => c.table === 'conversations' && c.insert)).toBe(false);
  });
});
