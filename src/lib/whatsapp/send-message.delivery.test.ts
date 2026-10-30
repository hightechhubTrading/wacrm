import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMessageToConversation } from './send-message';
const fixture = vi.hoisted(() => ({ failSave: false, events: [] as string[] }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
  isLegacyFormat: () => false,
  encrypt: () => 'encrypted',
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain = {
        update: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));
const db = {
  from: (table: string) => {
    let inserting = false;
    const read = () => {
      if (table === 'conversations')
        return {
          data: {
            id: 'conversation',
            account_id: 'account',
            contact: { id: 'contact', phone: '+15551234567' },
          },
          error: null,
        };
      if (table === 'whatsapp_config')
        return {
          data: {
            id: 'config',
            access_token: 'encrypted',
            phone_number_id: 'phone',
          },
          error: null,
        };
      if (table === 'messages' && inserting) {
        fixture.events.push('save');
        return {
          data: fixture.failSave ? null : { id: 'saved' },
          error: fixture.failSave ? { message: 'unavailable' } : null,
        };
      }
      return { data: null, error: null };
    };
    const chain = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      insert: () => {
        inserting = true;
        return chain;
      },
      single: async () => read(),
      maybeSingle: async () => read(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(read()).then(resolve),
    };
    return chain;
  },
} as unknown as SupabaseClient;
const send = (
  callback: (id: string) => Promise<void> = async () => {
    fixture.events.push('accepted');
  }
) =>
  sendMessageToConversation(db, 'account', {
    conversationId: 'conversation',
    messageType: 'text',
    contentText: 'hello',
    onProviderAccepted: callback,
  });
beforeEach(() => {
  fixture.failSave = false;
  fixture.events = [];
});
afterEach(() => vi.unstubAllGlobals());
it('classifies an explicit Meta 4xx rejection separately from network/5xx uncertainty', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: 'rejected', code: 100 } },
          { status: 400 }
        )
      )
  );
  await expect(send()).rejects.toMatchObject({
    code: 'meta_rejected',
    outcome: 'rejected',
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { message: 'unavailable' } }, { status: 503 })
      )
  );
  await expect(send()).rejects.toMatchObject({
    code: 'meta_error',
    outcome: 'unknown',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('connection lost'))
  );
  await expect(send()).rejects.toMatchObject({
    code: 'meta_error',
    outcome: 'unknown',
  });
  expect(fixture.events).toEqual([]);
});
it('records provider acceptance before local message persistence', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ messages: [{ id: 'wamid' }] }))
  );
  fixture.failSave = true;
  await expect(send()).rejects.toMatchObject({
    code: 'db_error',
    outcome: 'unknown',
  });
  expect(fixture.events).toEqual(['accepted', 'save']);
});
it('still persists the actual sent message if the acceptance ledger write fails', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ messages: [{ id: 'wamid' }] }));
  vi.stubGlobal('fetch', fetch);
  expect(
    await send(async () => {
      throw new Error('ledger unavailable');
    })
  ).toEqual({ messageId: 'saved', whatsappMessageId: 'wamid' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fixture.events).toEqual(['save']);
});
