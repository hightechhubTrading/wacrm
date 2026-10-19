import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: () => new Response('Forbidden', { status: 403 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response('Limited', { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
import { POST } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    supabase: { rpc: h.rpc },
    accountId: 'current-account',
    userId: 'admin',
  });
  h.checkRateLimit.mockReturnValue({ success: true });
});
it('imports source-backed drafts in parent order, without inventing prices', async () => {
  h.rpc.mockResolvedValue({ data: 39, error: null });
  const r = await POST();
  expect(r.status).toBe(200);
  const [name, args] = h.rpc.mock.calls[0];
  expect(name).toBe('import_ai_catalog_drafts');
  expect(args.p_account_id).toBe('current-account');
  const seen = new Set();
  for (const e of args.p_entries) {
    if (e.parent_key) expect(seen.has(e.parent_key)).toBe(true);
    seen.add(e.key);
    expect(e).not.toHaveProperty('price_min');
    expect(e.source_url).toMatch(/^https:\/\/hightechub.com/);
  }
  expect(
    args.p_entries.filter((e: { kind: string }) => e.kind === 'family')
  ).toHaveLength(10);
  expect(
    args.p_entries.filter((e: { kind: string }) => e.kind === 'variant')
  ).toHaveLength(5);
});
it('enforces admin authorization before importing', async () => {
  h.requireRole.mockRejectedValue(new Error('Forbidden'));
  expect((await POST()).status).toBe(403);
  expect(h.rpc).not.toHaveBeenCalled();
});
it('returns an actionable failure when migration/RPC is unavailable', async () => {
  h.rpc.mockResolvedValue({ data: null, error: { message: 'not installed' } });
  const r = await POST();
  expect(r.status).toBe(500);
  expect((await r.json()).error).toContain('migration 077');
});
