import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  operations: new Map<string, Record<string, unknown>>(),
  user: 'user',
  account: 'account',
  role: 'owner',
  conversationVisible: true,
  failClaim: false,
  failSettle: false,
  core: vi.fn(),
}));
function builder(table: string, admin = false) {
  const filters: Record<string, unknown> = {};
  let action = 'read',
    patch: Record<string, unknown> = {};
  const resolve = () => {
    if (table === 'profiles')
      return {
        data: { account_id: fixture.account, account_role: fixture.role },
        error: null,
      };
    if (table === 'conversations')
      return {
        data: fixture.conversationVisible ? { id: 'conversation' } : null,
        error: null,
      };
    if (table === 'outbound_send_operations') {
      if (action === 'insert') {
        if (fixture.failClaim) return { data: null, error: { code: '42P01' } };
        if (fixture.operations.has(patch.id as string))
          return { data: null, error: { code: '23505' } };
        fixture.operations.set(patch.id as string, {
          ...patch,
          state: 'sending',
        });
        return { data: null, error: null };
      }
      const row = fixture.operations.get(filters.id as string);
      if (action === 'update') {
        if (fixture.failSettle)
          return { data: null, error: { code: 'unavailable' } };
        if (row) Object.assign(row, patch);
        return { data: null, error: null };
      }
      const visible =
        admin ||
        (fixture.conversationVisible &&
          row?.user_id === fixture.user &&
          row?.account_id === fixture.account &&
          fixture.role !== 'viewer');
      return { data: visible ? (row ?? null) : null, error: null };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return chain;
    },
    insert: (data: Record<string, unknown>) => {
      action = 'insert';
      patch = data;
      return chain;
    },
    update: (data: Record<string, unknown>) => {
      action = 'update';
      patch = data;
      return chain;
    },
    single: async () => resolve(),
    maybeSingle: async () => resolve(),
    then: (fn: (v: unknown) => unknown) => Promise.resolve(resolve()).then(fn),
  };
  return chain;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: fixture.user ? { id: fixture.user } : null },
        error: null,
      }),
    },
    from: (table: string) => builder(table),
  }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from: (table: string) => builder(table, true) }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { send: {} },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock('@/lib/whatsapp/send-message', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/send-message')>()),
  sendMessageToConversation: fixture.core,
}));
import { GET, POST } from './route';
import { SendMessageError } from '@/lib/whatsapp/send-message';
const id = '10000000-0000-4000-8000-000000000001';
const post = (overrides = {}) =>
  POST(
    new Request('https://app.test/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({
        operation_id: id,
        conversation_id: 'conversation',
        message_type: 'text',
        content_text: 'hello',
        ...overrides,
      }),
    })
  );
const get = () =>
  GET(new Request(`https://app.test/api/whatsapp/send?operation_id=${id}`));
beforeEach(() => {
  fixture.operations.clear();
  Object.assign(fixture, {
    user: 'user',
    account: 'account',
    role: 'owner',
    conversationVisible: true,
    failClaim: false,
    failSettle: false,
  });
  fixture.core.mockReset().mockImplementation(async (_db, _account, params) => {
    await params.onProviderAccepted?.('wamid');
    return { messageId: 'saved', whatsappMessageId: 'wamid' };
  });
});
it('dispatches identical concurrent requests exactly once and reconciles the result', async () => {
  const results = await Promise.all([post(), post()]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(fixture.core).toHaveBeenCalledTimes(1);
  expect(await (await get()).json()).toMatchObject({
    outcome: 'accepted',
    message_id: 'saved',
  });
  await post();
  expect(fixture.core).toHaveBeenCalledTimes(1);
});
it('rejects changed content, actor or tenant on an existing ID without disclosing the result', async () => {
  await post();
  for (const change of [{ content_text: 'different' }])
    expect((await post(change)).status).toBe(409);
  fixture.user = 'other';
  expect((await post()).status).toBe(409);
  expect(await (await get()).json()).toMatchObject({ outcome: 'unknown' });
  fixture.user = 'user';
  fixture.account = 'other';
  expect((await post()).status).toBe(409);
  expect(fixture.core).toHaveBeenCalledTimes(1);
});
it('never reclaims an uncertain operation after a provider timeout', async () => {
  fixture.core.mockRejectedValue(
    new SendMessageError('meta_error', 'timeout', 502, 'unknown')
  );
  expect(await (await post()).json()).toMatchObject({ outcome: 'unknown' });
  await post();
  expect(fixture.core).toHaveBeenCalledTimes(1);
  expect(await (await get()).json()).toMatchObject({ outcome: 'unknown' });
});
it('keeps provider acceptance when subsequent persistence fails', async () => {
  fixture.core.mockImplementation(async (_db, _account, params) => {
    await params.onProviderAccepted('wamid');
    throw new SendMessageError('db_error', 'save failed', 500, 'unknown');
  });
  await post();
  expect(await (await get()).json()).toMatchObject({
    outcome: 'accepted',
    whatsapp_message_id: 'wamid',
  });
  await post();
  expect(fixture.core).toHaveBeenCalledTimes(1);
});
it('records a definite rejection and does not replay it under the same operation ID', async () => {
  fixture.core.mockRejectedValue(
    new SendMessageError('meta_rejected', 'rejected', 502, 'rejected')
  );
  expect(await (await post()).json()).toMatchObject({ outcome: 'rejected' });
  await post();
  expect(fixture.core).toHaveBeenCalledTimes(1);
  expect(await (await get()).json()).toMatchObject({ outcome: 'rejected' });
});
it('fails before provider dispatch when the ledger is unavailable', async () => {
  fixture.failClaim = true;
  expect(await (await post()).json()).toMatchObject({
    outcome: 'rejected',
    code: 'ledger_unavailable',
  });
  expect(fixture.core).not.toHaveBeenCalled();
});
it('retains the claim if result storage fails', async () => {
  fixture.failSettle = true;
  await post();
  await post();
  expect(fixture.core).toHaveBeenCalledTimes(1);
  expect(await (await get()).json()).toMatchObject({ outcome: 'unknown' });
});
it('denies viewers, missing conversations, invalid IDs and anonymous requests before side effects', async () => {
  fixture.role = 'viewer';
  expect((await post()).status).toBe(403);
  fixture.role = 'owner';
  fixture.conversationVisible = false;
  expect((await post()).status).toBe(404);
  fixture.conversationVisible = true;
  expect((await post({ operation_id: 'bad' })).status).toBe(400);
  fixture.user = '';
  expect((await post()).status).toBe(401);
  expect((await get()).status).toBe(401);
  expect(fixture.core).not.toHaveBeenCalled();
});
it('uses current conversation visibility for reconciliation', async () => {
  await post();
  fixture.conversationVisible = false;
  expect(await (await get()).json()).toMatchObject({ outcome: 'unknown' });
});
