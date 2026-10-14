import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logJevCheck } from './audit';

afterEach(() => vi.restoreAllMocks());
it('persists only judgment metadata and never logs failed database error bodies', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const insert = vi
    .fn()
    .mockResolvedValue({ error: { message: 'private body secret' } });
  const db = { from: () => ({ insert }) } as unknown as SupabaseClient;
  await logJevCheck(
    { accountId: 'acct', workflow: 'auto_reply', db },
    {
      mode: 'enforce',
      layer: 'output',
      outcome: 'allow',
      latencyMs: 100,
      judgments: { grounded: 0.98 },
    }
  );
  expect(insert.mock.calls[0][0]).toMatchObject({
    account_id: 'acct',
    question_version: 'sales-v3-emotion',
    judgments: { grounded: 0.98 },
  });
  expect(JSON.stringify([info.mock.calls, warn.mock.calls])).not.toContain(
    'private body secret'
  );
  expect(insert.mock.calls[0][0]).not.toHaveProperty('state');
});
it('continues when audit storage is missing or unavailable', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const db = {
    from: () => {
      throw new Error('missing table');
    },
  } as unknown as SupabaseClient;
  await expect(
    logJevCheck(
      { accountId: 'acct', workflow: 'auto_reply', db },
      {
        mode: 'enforce',
        layer: 'output',
        outcome: 'handoff',
        latencyMs: 0,
      }
    )
  ).resolves.toBeUndefined();
});
