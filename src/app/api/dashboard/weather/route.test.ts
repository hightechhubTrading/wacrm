import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(),
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));

import { requireRole } from '@/lib/auth/account';
import { GET } from './route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dashboard weather', () => {
  it('does not request weather for an unauthenticated user', async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error('Unauthorized'));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await GET()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles an upstream outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    );
    expect((await GET()).status).toBe(502);
  });

  it('rejects incomplete readings rather than showing broken temperatures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ current: {}, daily: {} }))
    );
    expect((await GET()).status).toBe(502);
  });
});
