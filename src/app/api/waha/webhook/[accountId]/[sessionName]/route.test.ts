import { describe, it, expect, vi, beforeEach } from 'vitest';

const messageInserts: Record<string, unknown>[] = [];
const conversationUpdates: Record<string, unknown>[] = [];
const conversationInserts: Record<string, unknown>[] = [];
// Rows findOrCreateConversation's lookup resolves to. Empty (default) →
// it creates a new conversation; populated → it reuses that one.
let existingConversations: Record<string, unknown>[] = [];

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
          table === 'conversations'
            ? Promise.resolve({ data: existingConversations, error: null })
            : Promise.resolve({ data: [], error: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') messageInserts.push(row);
          if (table === 'conversations') conversationInserts.push(row);
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
  conversationInserts.length = 0;
  existingConversations = [];
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

  it('assigns a NEWLY created conversation to the agent whose number received it', async () => {
    // Without this the CRM's first reply to a customer who messaged
    // Sarah's personal number would go out over the shared Meta business
    // number — a different number than the one the customer is talking
    // to. resolveAgentWahaChannel keys off assigned_agent_id, so the
    // assignment IS the routing.
    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: {
          id: 'msg-abc',
          timestamp: 1699999999,
          from: '15551234567@c.us',
          fromMe: false,
          body: 'Hi Sarah',
        },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );

    expect(res.status).toBe(200);
    expect(conversationInserts).toHaveLength(1);
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      assigned_agent_id: 'agent-user-1',
    });
  });

  it('never reassigns an EXISTING conversation to the receiving agent', async () => {
    // "No retroactive handoff" is an explicit rule of this feature: an
    // in-progress conversation someone else owns must not be yanked away
    // just because the customer also pinged this agent's number.
    existingConversations = [
      { id: 'conv-existing', contact_id: 'contact-1', assigned_agent_id: null, unread_count: 3 },
    ];

    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: {
          id: 'msg-def',
          timestamp: 1699999999,
          from: '15551234567@c.us',
          fromMe: false,
          body: 'Following up',
        },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );

    expect(res.status).toBe(200);
    expect(conversationInserts).toHaveLength(0);
    // The only conversation write is the last-message/unread bookkeeping —
    // it must not carry an assignment.
    expect(conversationUpdates).toHaveLength(1);
    expect(conversationUpdates[0]).not.toHaveProperty('assigned_agent_id');
    expect(conversationUpdates[0]).toMatchObject({ unread_count: 4 });
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

  it('ignores a group message (from ending in @g.us)', async () => {
    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: {
          id: 'x',
          timestamp: 1699999999,
          from: '120363000000000000@g.us',
          fromMe: false,
          body: 'hi group',
        },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );
    expect(res.status).toBe(200);
    expect(messageInserts).toHaveLength(0);
  });
});
