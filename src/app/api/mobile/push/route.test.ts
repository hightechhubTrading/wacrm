import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { decrypt } from '@/lib/whatsapp/encryption';
const h = vi.hoisted(() => ({
  account: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  config: vi.fn(),
  rate: vi.fn(),
  filters: [] as unknown[],
  role: 'agent',
}));
vi.mock('@/lib/mobile/conversation', async (original) => ({
  ...(await original<typeof import('@/lib/mobile/conversation')>()),
  mobileAccount: h.account,
}));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/mobile/push/config', () => ({ activePushConfig: h.config }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.rate }));
import { GET, POST, OPTIONS } from './route';
const id = '12345678-1234-4234-8234-123456789abc',
  session = '22345678-1234-4234-8234-123456789abc';
const secret = 'a'.repeat(43),
  token = 'synthetic_notification_token_only';
const bearer = `header.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.signature`;
const config = {
  projectId: 'test-project',
  appId: 'com.hightechhub.crm.demo',
  environment: 'development',
  credentialsFile: '/private/never-returned.json',
};
const registration = () => ({
  action: 'register',
  id,
  secret,
  token,
  version: 1,
  appId: config.appId,
  projectId: config.projectId,
});
function req(body?: unknown, overrides: Record<string, string> = {}) {
  return new Request('https://crm.test/api/mobile/push', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'https://localhost',
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      ...overrides,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.role = 'agent';
  h.filters = [];
  h.config.mockReturnValue(config);
  h.rate.mockReturnValue({ success: true });
  h.rpc.mockResolvedValue({ data: true, error: null });
  h.account.mockImplementation(async () => ({
    profile: { account_id: 'account-a', account_role: h.role },
    user: { id: 'user-a' },
    db: {},
  }));
  h.admin.mockReturnValue({
    rpc: h.rpc,
    from: (table: string) => {
      expect(table).toBe('mobile_push_preferences');
      const chain = {
        select: (fields: string) => {
          expect(fields).toBe('enabled,quiet_start,quiet_end,timezone');
          return chain;
        },
        eq: (...args: unknown[]) => {
          h.filters.push(args);
          return chain;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  });
});
it('returns only masked setup/preferences under the verified user and account', async () => {
  const r = await GET(req());
  expect(await r.json()).toEqual({
    configured: true,
    eligible: true,
    appId: config.appId,
    projectId: config.projectId,
    environment: 'development',
    preferences: {
      enabled: true,
      quietStart: null,
      quietEnd: null,
      timezone: 'Asia/Qatar',
    },
  });
  expect(h.filters).toEqual([
    ['user_id', 'user-a'],
    ['account_id', 'account-a'],
  ]);
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe(
    'https://localhost'
  );
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
});
it('encrypts device tokens, hashes revocation secrets and derives session/ownership server-side', async () => {
  expect((await POST(req(registration()))).status).toBe(200);
  expect(h.rpc.mock.calls[0][0]).toBe('register_mobile_push_device');
  const args = h.rpc.mock.calls[0][1];
  expect(args).toMatchObject({
    p_id: id,
    p_account: 'account-a',
    p_user: 'user-a',
    p_session: session,
    p_environment: 'development',
    p_version: 1,
  });
  expect(args.p_secret_hash).toBe(
    createHash('sha256').update(secret).digest('hex')
  );
  expect(args.p_token_hash).toBe(
    createHash('sha256').update(token).digest('hex')
  );
  expect(args.p_ciphertext).not.toContain(token);
  expect(decrypt(args.p_ciphertext)).toBe(token);
});
it('never trusts a client-supplied account, role, session or environment', async () => {
  for (const extra of [
    { userId: 'other' },
    { accountId: 'other' },
    { sessionId: session },
    { environment: 'production' },
  ]) {
    expect((await POST(req({ ...registration(), ...extra }))).status).toBe(400);
  }
  expect(h.admin).not.toHaveBeenCalled();
});
it('denies missing verified sessions, viewers and server-side binding conflicts', async () => {
  expect(
    (await POST(req(registration(), { Authorization: 'Bearer no-session' })))
      .status
  ).toBe(401);
  expect(h.rpc).not.toHaveBeenCalled();
  h.role = 'viewer';
  expect((await POST(req(registration()))).status).toBe(403);
  h.role = 'agent';
  h.rpc.mockResolvedValue({ data: false });
  expect((await POST(req(registration()))).status).toBe(409);
  h.account.mockResolvedValue({ response: Response.json({}, { status: 401 }) });
  expect((await POST(req(registration()))).status).toBe(401);
});
it('requires configured Firebase and matching project/application before registration', async () => {
  h.config.mockReturnValue(null);
  expect((await POST(req(registration()))).status).toBe(503);
  h.config.mockReturnValue(config);
  for (const extra of [
    { projectId: 'other-project' },
    { appId: 'other.app' },
    { token: 'short' },
    { version: 0 },
    { version: 1.5 },
    { version: 2147483648 },
  ])
    expect((await POST(req({ ...registration(), ...extra }))).status).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();
});
it('allows a device capability to revoke after auth expiry without exposing existence', async () => {
  h.account.mockRejectedValue(new Error('must not consult expired auth'));
  h.config.mockReturnValue(null);
  const r = await POST(
    req({ action: 'revoke', id, secret }, { Authorization: '' })
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ revoked: true });
  expect(h.account).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls[0]).toEqual([
    'revoke_mobile_push_device',
    {
      p_id: id,
      p_secret_hash: createHash('sha256').update(secret).digest('hex'),
    },
  ]);
});
it('validates timezone, minute ranges and both quiet-hour endpoints', async () => {
  const body = {
    action: 'preferences',
    enabled: true,
    quietStart: 1320,
    quietEnd: 480,
    timezone: 'Asia/Qatar',
  };
  expect((await POST(req(body))).status).toBe(200);
  expect(h.rpc.mock.calls[0]).toEqual([
    'set_mobile_push_preferences',
    {
      p_account: 'account-a',
      p_user: 'user-a',
      p_enabled: true,
      p_quiet_start: 1320,
      p_quiet_end: 480,
      p_timezone: 'Asia/Qatar',
    },
  ]);
  h.rpc.mockClear();
  for (const extra of [
    { timezone: 'Mars/Invalid' },
    { quietStart: -1 },
    { quietEnd: 1440 },
    { quietEnd: null },
    { enabled: 'true' },
  ])
    expect((await POST(req({ ...body, ...extra }))).status).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();
});
it('rejects foreign origins, malformed/oversized bodies and unsupported content types before privileges', async () => {
  expect(
    (await POST(req(registration(), { Origin: 'https://foreign.test' }))).status
  ).toBe(403);
  expect(
    (await POST(req(registration(), { 'Content-Type': 'text/plain' }))).status
  ).toBe(400);
  expect(
    (await POST(req({ ...registration(), token: 'a'.repeat(9000) }))).status
  ).toBe(413);
  expect(h.admin).not.toHaveBeenCalled();
  expect(
    (
      await OPTIONS(
        new Request('https://crm.test/api/mobile/push', {
          method: 'OPTIONS',
          headers: { Origin: 'https://localhost' },
        })
      )
    ).status
  ).toBe(204);
  expect(
    (
      await OPTIONS(
        new Request('https://crm.test/api/mobile/push', {
          method: 'OPTIONS',
          headers: { Origin: 'https://foreign.test' },
        })
      )
    ).status
  ).toBe(403);
});
it('rate-limits registration and independent revocation capabilities', async () => {
  h.rate.mockReturnValue({ success: false });
  expect((await POST(req(registration()))).status).toBe(429);
  expect((await POST(req({ action: 'revoke', id, secret }))).status).toBe(429);
  expect(h.rpc).not.toHaveBeenCalled();
});
