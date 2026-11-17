import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  send: vi.fn(),
  admin: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
  visible: true,
  conversation: true,
  stale: false,
  window: true,
  claimError: false,
  alreadySent: false,
  recordError: false,
  patch: null as unknown,
  filters: [] as unknown[],
}));
vi.mock('@/lib/whatsapp/send-message', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/send-message')>()),
  sendMessageToConversation: h.send,
}));
vi.mock('@/lib/quotations/admin-client', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.rate,
  RATE_LIMITS: { send: {} },
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
import { dispatchQuotation } from './dispatch';
import { SendMessageError } from '@/lib/whatsapp/send-message';
const id = '12345678-1234-4234-8234-123456789abc',
  doc = '22345678-1234-4234-8234-123456789abc',
  conv = '32345678-1234-4234-8234-123456789abc',
  path = `${id}/rev-2-${doc}.pdf`;
let ctx: Parameters<typeof dispatchQuotation>[0];
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(h, {
    visible: true,
    conversation: true,
    stale: false,
    window: true,
    claimError: false,
    alreadySent: false,
    recordError: false,
    patch: null,
    filters: [],
  });
  h.rate.mockReturnValue({ success: true });
  h.send.mockResolvedValue({ messageId: 'message-a' });
  h.rpc.mockResolvedValue({ error: null });
  h.admin.mockReturnValue({
    rpc: h.rpc,
    from: () => ({
      update: (p: unknown) => {
        h.patch = p;
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
  });
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: (...v: unknown[]) => {
        h.filters.push([table, ...v]);
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        error: null,
        data:
          table === 'quotations'
            ? h.visible
              ? {
                  id,
                  revision: 2,
                  workspace_version: 3,
                  pdf_storage_path: path,
                }
              : null
            : table === 'quotation_documents'
              ? {
                  id: doc,
                  storage_path: path,
                  workspace_version: h.stale ? 2 : 3,
                  revision: 2,
                  snapshot: { reference: 'HT-TEST' },
                }
              : table === 'conversations'
                ? h.conversation
                  ? { id: conv }
                  : null
                : table === 'messages'
                  ? {
                      created_at: new Date(
                        Date.now() - (h.window ? 60000 : 25 * 3600000)
                      ).toISOString(),
                    }
                  : null,
      }),
    };
    return q;
  };
  ctx = {
    accountId: 'account-a',
    userId: 'user-a',
    supabase: {
      from: query,
      storage: {
        from: () => ({
          getPublicUrl: () => ({
            data: { publicUrl: 'https://fixture.test/' + path },
          }),
        }),
      },
      rpc: async () => ({
        data: {
          alreadySent: h.alreadySent,
          messageId: h.alreadySent ? 'prior-message' : undefined,
        },
        error: h.claimError ? { message: 'fixture conflict' } : null,
      }),
    } as unknown as Parameters<typeof dispatchQuotation>[0]['supabase'],
  };
});
const body = () => ({
  documentId: doc,
  conversationId: conv,
  caption: 'Synthetic quotation',
});
it('reuses the current document claim and records acceptance after sending', async () => {
  const r = await dispatchQuotation(ctx, id, body());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ success: true, message_id: 'message-a' });
  expect(h.send).toHaveBeenCalledOnce();
  expect(h.send.mock.calls[0][2]).toMatchObject({
    conversationId: conv,
    messageType: 'document',
    filename: 'HT-TEST-rev-2.pdf',
  });
  expect(h.rpc).toHaveBeenCalledWith('complete_quotation_send', {
    p_document_id: doc,
    p_message_id: 'message-a',
  });
  expect(h.filters).toContainEqual(['quotations', 'account_id', 'account-a']);
  expect(h.filters).toContainEqual([
    'quotation_documents',
    'account_id',
    'account-a',
  ]);
});
it('denies inaccessible, stale, mismatched conversation and expired window before transport', async () => {
  h.visible = false;
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(404);
  h.visible = true;
  h.stale = true;
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(409);
  h.stale = false;
  h.conversation = false;
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(404);
  h.conversation = true;
  h.window = false;
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(400);
  expect(h.send).not.toHaveBeenCalled();
});
it('does not repeat accepted documents or send after a failed claim', async () => {
  h.alreadySent = true;
  expect(await (await dispatchQuotation(ctx, id, body())).json()).toMatchObject(
    { alreadySent: true, message_id: 'prior-message' }
  );
  h.alreadySent = false;
  h.claimError = true;
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(409);
  expect(h.send).not.toHaveBeenCalled();
});
it('retains unknown provider outcomes and only releases known rejections', async () => {
  h.send.mockRejectedValueOnce(
    new SendMessageError(
      'meta_error',
      'Synthetic network failure',
      502,
      'unknown'
    )
  );
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(502);
  expect(h.patch).toEqual({ send_state: 'uncertain' });
  h.send.mockRejectedValueOnce(
    new SendMessageError(
      'meta_rejected',
      'Synthetic rejection',
      502,
      'rejected'
    )
  );
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(502);
  expect(h.patch).toEqual({ send_state: 'ready' });
});
it('does not imply CRM recording succeeded when provider accepted but recording failed', async () => {
  h.rpc.mockResolvedValue({ error: { message: 'Synthetic storage failure' } });
  expect(await (await dispatchQuotation(ctx, id, body())).json()).toMatchObject(
    { success: true, recordingPending: true }
  );
  expect(h.send).toHaveBeenCalledOnce();
});
it('keeps validation and rate limits before provider actions', async () => {
  expect((await dispatchQuotation(ctx, id, {})).status).toBe(400);
  h.rate.mockReturnValue({ success: false });
  expect((await dispatchQuotation(ctx, id, body())).status).toBe(429);
  expect(h.send).not.toHaveBeenCalled();
});
