import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleCallWebhook,
  normalizeCallEvent,
  recordCallPermissionReply,
} from './webhook';

describe('calling webhooks', () => {
  it('records permission decisions with a schema-valid message status and account-scoped preview', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockReturnThis();
    const updateChain = {
      eq,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    eq.mockReturnValue(updateChain);
    const update = vi.fn().mockReturnValue(updateChain);
    const db = {
      from: (table: string) => (table === 'messages' ? { insert } : { update }),
    } as unknown as SupabaseClient;
    await recordCallPermissionReply(db, {
      conversationId: 'conv-a',
      accountId: 'account-a',
      unreadCount: 2,
      messageId: 'wamid.permission',
      accepted: true,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivered',
        content_text: 'WhatsApp call permission granted',
      })
    );
    expect(eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ unread_count: 3 })
    );
  });
  it('distinguishes an incoming offer from an outbound answer', () => {
    const common = { id: 'wacid.1', event: 'connect', timestamp: '1700000000' };
    expect(
      normalizeCallEvent({
        ...common,
        session: { sdp_type: 'offer', sdp: 'audio' },
      })
    ).toMatchObject({
      direction: 'inbound',
      state: 'ringing',
      remote_sdp_type: 'offer',
    });
    expect(
      normalizeCallEvent({
        ...common,
        session: { sdp_type: 'answer', sdp: 'audio' },
      })
    ).toMatchObject({
      direction: 'outbound',
      state: 'connecting',
      remote_sdp_type: 'answer',
    });
  });
  it('records unanswered COMPLETED inbound calls as missed', () => {
    expect(
      normalizeCallEvent({
        id: 'wacid.1',
        event: 'terminate',
        timestamp: '1700000060',
        status: 'COMPLETED',
        direction: 'USER_INITIATED',
      })
    ).toMatchObject({
      state: 'missed',
      answered_at: null,
      ended_at: '2023-11-14T22:14:20.000Z',
    });
  });
  it('records duration and preserves explicit failures', () => {
    expect(
      normalizeCallEvent({
        id: 'wacid.1',
        event: 'terminate',
        timestamp: '1700000060',
        start_time: '1700000000',
        duration: 60,
        status: 'COMPLETED',
      })
    ).toMatchObject({ state: 'completed', duration_seconds: 60 });
    expect(
      normalizeCallEvent({
        id: 'wacid.1',
        event: 'terminate',
        timestamp: '1700000060',
        status: 'FAILED',
      })
    ).toMatchObject({ state: 'failed' });
  });
  it('only accepts UUID correlation IDs', () => {
    const common = { id: 'wacid.1', event: 'connect', timestamp: '1700000000' };
    expect(
      normalizeCallEvent({
        ...common,
        biz_opaque_callback_data: 'malicious-id',
      }).local_id
    ).toBeNull();
    expect(
      normalizeCallEvent({
        ...common,
        biz_opaque_callback_data: '11111111-1111-4111-8111-111111111111',
      }).local_id
    ).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('routes statuses through the durable account-scoped reducer', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { account_id: 'account-a' },
              error: null,
            }),
          }),
        }),
      })),
      rpc,
    } as unknown as SupabaseClient;
    await handleCallWebhook(
      {
        metadata: { phone_number_id: '123' },
        statuses: [
          { id: 'wacid.1', status: 'ACCEPTED', timestamp: '1700000000' },
        ],
      },
      db
    );
    expect(rpc).toHaveBeenCalledWith('ingest_whatsapp_call', {
      p_account_id: 'account-a',
      p_event: expect.objectContaining({
        meta_call_id: 'wacid.1',
        state: 'active',
        event: 'status',
      }),
    });
  });
  it('throws on persistence failure so the signed endpoint can request retry', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { account_id: 'account-a' } }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({ error: { message: 'offline' } }),
    } as unknown as SupabaseClient;
    await expect(
      handleCallWebhook(
        {
          metadata: { phone_number_id: '123' },
          statuses: [
            { id: 'wacid.1', status: 'ACCEPTED', timestamp: '1700000000' },
          ],
        },
        db
      )
    ).rejects.toThrow('persistence failed');
  });
});
