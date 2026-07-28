import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBroadcast, BroadcastError } from './broadcast-core';
import { encrypt } from './encryption';

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ------------------------------------------------------------
// Opt-out gate. Chainable stub scripted just enough for
// createBroadcast's actual sequence: whatsapp_config lookup,
// message_templates lookup (returns none), a contacts .like() lookup
// per recipient (existing rows only — no insert path exercised), then
// the broadcasts + broadcast_recipients inserts.
// ------------------------------------------------------------
interface StubContact {
  id: string;
  phone: string;
  opted_out?: boolean;
}

function makeDb(contacts: StubContact[]): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' = 'select';
  let insertPayload: unknown = null;

  const builder: Record<string, unknown> = {
    select: () => {
      if (mode === 'insert' && table === 'broadcast_recipients') {
        const rows = (insertPayload as { contact_id: string }[]).map((r, i) => ({
          id: `recipient-${i}`,
          contact_id: r.contact_id,
        }));
        return Promise.resolve({ data: rows, error: null });
      }
      return builder;
    },
    insert: (payload: unknown) => {
      mode = 'insert';
      insertPayload = payload;
      return builder;
    },
    eq: () => builder,
    like: (_col: string, pattern: string) => {
      const suffix = String(pattern).replace(/^%/, '');
      const matches = contacts.filter((c) => c.phone.endsWith(suffix));
      return Promise.resolve({ data: matches, error: null });
    },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => {
      if (table === 'whatsapp_config') {
        return Promise.resolve({
          data: { phone_number_id: 'PNID', access_token: encrypt('fake-token') },
          error: null,
        });
      }
      if (table === 'broadcasts' && mode === 'insert') {
        return Promise.resolve({ data: { id: 'bcast-1' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      insertPayload = null;
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('createBroadcast — opt-out gate', () => {
  it('marks an opted-out recipient skipped and excludes them from the send plan', async () => {
    const optOutDb = makeDb([
      { id: 'contact-out', phone: '14155550111', opted_out: true },
      { id: 'contact-in', phone: '14155550122', opted_out: false },
    ]);

    const plan = await createBroadcast(optOutDb, 'acct-1', 'user-1', {
      templateName: 'promo',
      recipients: [{ to: '+14155550111' }, { to: '+14155550122' }],
    });

    // Only the non-opted-out recipient is queued to actually send.
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0].phone).toBe('14155550122');
  });
});
