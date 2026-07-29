import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// Real crypto isn't needed for the WAHA-routing tests below — they
// never reach the Meta `whatsapp_config` decrypt path (the WAHA
// branch returns before it), and `resolveAgentWahaChannel`'s own
// `decrypt(api_key)` call just needs to round-trip a canned value.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace('enc:', ''),
  encrypt: (v: string) => `enc:${v}`,
  isLegacyFormat: () => false,
}));

const { sendWahaIndividualText, WahaSendError } = vi.hoisted(() => {
  class WahaSendError extends Error {}
  return {
    sendWahaIndividualText: vi.fn(),
    WahaSendError,
  };
});
vi.mock('@/lib/notifications/waha-client', () => ({
  sendWahaIndividualText,
  WahaSendError,
}));

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

// ------------------------------------------------------------
// WAHA routing. Chainable, table-keyed Supabase stub (same shape as
// the one in src/app/api/whatsapp/send/route.test.ts): a fresh
// builder per `.from()` call, methods chain by returning the builder,
// and `.single()`/`.maybeSingle()`/`await` all resolve to a canned
// row keyed off which table + whether `.insert()`/`.update()` ran.
// ------------------------------------------------------------
const CONTACT = { id: 'contact-1', phone: '+15551234567' };
const WAHA_CONVERSATION = {
  id: 'conv-1',
  account_id: 'acct-1',
  assigned_agent_id: 'agent-user-1',
  contact: CONTACT,
};
const WAHA_PROFILE = { waha_session_name: 'sarah-agent', phone: '+19998887777' };
const WAHA_CONFIG = {
  base_url: 'https://waha.example.com',
  api_key: 'enc:key',
  is_active: true,
};

function makeWahaDb() {
  const messageInserts: Record<string, unknown>[] = [];
  const conversationUpdates: Record<string, unknown>[] = [];

  function builder(table: string) {
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: unknown = null;

    const result = () => {
      if (table === 'conversations') {
        if (mode === 'update') {
          conversationUpdates.push(payload as Record<string, unknown>);
          return { data: null, error: null };
        }
        return { data: WAHA_CONVERSATION, error: null };
      }
      if (table === 'profiles') {
        return { data: WAHA_PROFILE, error: null };
      }
      if (table === 'waha_config') {
        return { data: WAHA_CONFIG, error: null };
      }
      if (table === 'messages' && mode === 'insert') {
        messageInserts.push(payload as Record<string, unknown>);
        return { data: { id: 'msg-1' }, error: null };
      }
      return { data: null, error: null };
    };

    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = vi.fn(chain);
    b.insert = vi.fn((p: unknown) => {
      mode = 'insert';
      payload = p;
      return b;
    });
    b.update = vi.fn((p: unknown) => {
      mode = 'update';
      payload = p;
      return b;
    });
    b.single = vi.fn(() => Promise.resolve(result()));
    b.maybeSingle = vi.fn(() => Promise.resolve(result()));
    b.then = (resolve: (v: unknown) => unknown) => resolve(result());
    return b;
  }

  const db = {
    from: vi.fn((table: string) => builder(table)),
  } as unknown as SupabaseClient;

  return { db, messageInserts, conversationUpdates };
}

describe('sendMessageToConversation — WAHA channel routing', () => {
  beforeEach(() => {
    sendWahaIndividualText.mockReset();
  });

  it('routes to WAHA when the conversation is assigned to an agent with a connected channel', async () => {
    sendWahaIndividualText.mockResolvedValue({ ok: true });
    const { db, messageInserts, conversationUpdates } = makeWahaDb();

    const result = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: 'Hi, this is Sarah!',
    });

    expect(sendWahaIndividualText).toHaveBeenCalledWith(
      expect.objectContaining({
        session: 'sarah-agent',
        toPhone: expect.any(String),
        text: 'Hi, this is Sarah!',
        baseUrl: 'https://waha.example.com',
        apiKey: 'key',
      })
    );
    expect(result.messageId).toBe('msg-1');

    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      content_text: 'Hi, this is Sarah!',
      channel: 'waha',
      sender_type: 'agent',
    });

    expect(conversationUpdates).toHaveLength(1);
    expect(conversationUpdates[0]).toMatchObject({
      last_message_text: 'Hi, this is Sarah!',
    });
  });

  it('rejects a non-text message type when routed to WAHA', async () => {
    const { db } = makeWahaDb();

    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'template',
        templateName: 'some_template',
      })
    ).rejects.toThrow(/only supports plain text messages/i);

    expect(sendWahaIndividualText).not.toHaveBeenCalled();
  });

  it('surfaces a WahaSendError as a SendMessageError instead of throwing raw', async () => {
    sendWahaIndividualText.mockRejectedValue(new WahaSendError('WAHA returned 500'));
    const { db } = makeWahaDb();

    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'hello',
      })
    ).rejects.toMatchObject({
      code: 'waha_error',
      status: 502,
    });
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});
