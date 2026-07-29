import { describe, it, expect, vi, beforeEach } from 'vitest';

const messageInserts: Record<string, unknown>[] = [];
const conversationUpdates: Record<string, unknown>[] = [];

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => {
          if (table === 'profiles') {
            return Promise.resolve({
              data: {
                user_id: 'agent-user-1',
                waha_webhook_secret: 'enc:correct-secret',
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        like: () => builder,
        order: () => builder,
        limit: () =>
          table === 'contacts'
            ? Promise.resolve({ data: [], error: null })
            : Promise.resolve({ data: [], error: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') messageInserts.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data:
                    table === 'contacts'
                      ? { id: 'contact-1', phone: '+15551234567', name: '+15551234567' }
                      : table === 'conversations'
                        ? { id: 'conv-1', contact_id: 'contact-1' }
                        : { id: 'msg-1' },
                  error: null,
                }),
            }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          if (table === 'conversations') conversationUpdates.push(patch);
          return builder;
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace('enc:', ''),
}));

import { POST } from './route';

beforeEach(() => {
  messageInserts.length = 0;
  conversationUpdates.length = 0;
});

function makeRequest(secret: string, body: unknown) {
  return new Request(
    `http://localhost/api/waha/webhook/acct-1/sarah-agent?secret=${secret}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

describe('POST /api/waha/webhook/[accountId]/[sessionName]', () => {
  it('rejects a request with the wrong secret', async () => {
    const res = await POST(makeRequest('wrong-secret', {}), {
      params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }),
    });
    expect(res.status).toBe(404);
    expect(messageInserts).toHaveLength(0);
  });

  it('inserts a customer message with channel=waha for an inbound text event', async () => {
    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: {
          id: 'true_15551234567@c.us_ABC',
          timestamp: 1699999999,
          from: '15551234567@c.us',
          fromMe: false,
          body: 'Hello!',
          hasMedia: false,
        },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );

    expect(res.status).toBe(200);
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0]).toMatchObject({
      sender_type: 'customer',
      channel: 'waha',
      content_text: 'Hello!',
    });
    expect(conversationUpdates).toHaveLength(1);
  });

  it('ignores an echo of the agent\'s own outbound message (fromMe: true)', async () => {
    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: { id: 'x', timestamp: 1699999999, from: '15551234567@c.us', fromMe: true, body: 'hi' },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );
    expect(res.status).toBe(200);
    expect(messageInserts).toHaveLength(0);
  });
});
