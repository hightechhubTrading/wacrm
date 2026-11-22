import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@/lib/auth/account', async (original) => ({
  ...(await original<typeof import('@/lib/auth/account')>()),
  requireRole: h.role,
}));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
vi.mock('@/lib/mobile/push/config', () => ({
  activePushConfig: async () => null,
}));
import { GET, PATCH, POST } from './route';
import { ForbiddenError } from '@/lib/auth/account';
beforeEach(() => {
  vi.resetAllMocks();
  h.role.mockResolvedValue({
    accountId: 'verified-account',
    userId: 'verified-user',
    supabase: { from: h.from, rpc: h.rpc },
  });
  h.from.mockReturnValue({ upsert: h.upsert });
  h.upsert.mockResolvedValue({ error: null });
  h.rpc.mockResolvedValue({ data: 2, error: null });
});
const request = (minutes: number) =>
  new Request('https://crm.test/api/notifications/health', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_id: 'other-account',
      enabled: true,
      minutes,
    }),
  });
it('requires admin for health details', async () => {
  h.role.mockRejectedValue(new ForbiddenError());
  expect((await GET()).status).toBe(403);
  expect(h.from).not.toHaveBeenCalled();
});
it('scopes policy to authenticated account', async () => {
  expect((await PATCH(request(15))).status).toBe(200);
  expect(h.role).toHaveBeenCalledWith('admin');
  expect(h.upsert).toHaveBeenCalledWith(
    {
      account_id: 'verified-account',
      escalation_enabled: true,
      escalation_minutes: 15,
    },
    { onConflict: 'account_id' }
  );
});
it.each([0, 4, 1441, 1.5])(
  'rejects unsafe escalation duration %s',
  async (minutes) => {
    expect((await PATCH(request(minutes))).status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  }
);
it('retries only failed notices in the verified account', async () => {
  expect((await POST()).status).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith('retry_notification_events', {
    p_account: 'verified-account',
  });
});
