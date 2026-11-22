import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ role: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth/account', async (original) => ({
  ...(await original<typeof import('@/lib/auth/account')>()),
  requireRole: h.role,
}));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: h.admin }));
import { PATCH } from './route';
import { ForbiddenError } from '@/lib/auth/account';
beforeEach(() => {
  vi.resetAllMocks();
  h.role.mockResolvedValue({
    accountId: 'verified-account',
    userId: 'verified-user',
    supabase: { rpc: h.rpc },
  });
  h.rpc.mockResolvedValue({ error: null });
});
const request = (body: unknown) =>
  new Request('https://crm.test/api/notifications/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
it('derives account from authenticated context instead of request data', async () => {
  expect(
    (
      await PATCH(
        request({
          accountId: 'other-account',
          foreground: true,
          sound: false,
          supervise: false,
        })
      )
    ).status
  ).toBe(200);
  expect(h.role).toHaveBeenCalledWith('agent');
  expect(h.rpc).toHaveBeenCalledWith('set_notification_channels', {
    p_account: 'verified-account',
    p_foreground: true,
    p_sound: false,
    p_supervise: false,
  });
});
it('rejects malformed preferences before database writes', async () => {
  expect(
    (
      await PATCH(
        request({ foreground: 'true', sound: false, supervise: false })
      )
    ).status
  ).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();
});
it('denies viewers', async () => {
  h.role.mockRejectedValue(new ForbiddenError());
  expect(
    (await PATCH(request({ foreground: true, sound: false, supervise: false })))
      .status
  ).toBe(403);
  expect(h.rpc).not.toHaveBeenCalled();
});

it('rejects partial quiet hours without changing channel policy', async () => {
  expect(
    (
      await PATCH(
        request({
          foreground: true,
          sound: false,
          supervise: false,
          quiet: { start: 1320, end: null, timezone: 'Asia/Qatar' },
        })
      )
    ).status
  ).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();
});
it('saves channel and quiet policy together in the verified account', async () => {
  expect(
    (
      await PATCH(
        request({
          foreground: true,
          sound: false,
          supervise: false,
          quiet: { start: 1320, end: 420, timezone: 'Asia/Qatar' },
        })
      )
    ).status
  ).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith('set_notification_channel_policy', {
    p_account: 'verified-account',
    p_foreground: true,
    p_sound: false,
    p_supervise: false,
    p_start: 1320,
    p_end: 420,
    p_timezone: 'Asia/Qatar',
  });
});
