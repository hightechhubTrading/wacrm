import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureServerOperation, performanceFetch } from './performance';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('optional performance diagnostics', () => {
  it('preserves fetch arguments and stays silent by default', async () => {
    vi.stubEnv('PERFORMANCE_LOGS', '0');
    const response = new Response('ok'),
      fetch = vi.fn(async () => response),
      log = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetch);
    const init = { headers: { Authorization: 'Bearer fixture' } };
    expect(
      await performanceFetch(
        'https://example.test/rest/v1/profiles?user_id=eq.private',
        init
      )
    ).toBe(response);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/rest/v1/profiles?user_id=eq.private',
      init
    );
    expect(log).not.toHaveBeenCalled();
  });
  it('logs operation durations without URLs, credentials or filters', async () => {
    vi.stubEnv('PERFORMANCE_LOGS', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private body'))
    );
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    await performanceFetch(
      'https://credential@example.test/rest/v1/rpc/inbox_list?customer=private'
    );
    const serialized = String(log.mock.calls[0][0]);
    expect(JSON.parse(serialized)).toMatchObject({
      event: 'crm-performance',
      operation: 'supabase.rpc.inbox_list',
      durationMs: expect.any(Number),
    });
    expect(serialized).not.toMatch(/credential|example|customer|private/);
  });
  it('preserves rejected operations and records their duration', async () => {
    vi.stubEnv('PERFORMANCE_LOGS', '1');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {}),
      error = new Error('fixture');
    await expect(
      measureServerOperation('account.resolve', async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(log).toHaveBeenCalledOnce();
  });
});
