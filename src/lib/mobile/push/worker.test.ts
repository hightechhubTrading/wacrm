import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/whatsapp/encryption';
import { drainMobilePush } from './worker';
import type { PushConfig } from './config';
const config: PushConfig = {
  projectId: 'test-project',
  appId: 'com.hightechhub.crm.demo',
  environment: 'development',
  credentialsFile: '/unused',
};
const token = 'synthetic_token_for_worker_testing_only';
const prepared = () => ({
  job_id: 'job-a',
  device_id: 'device-a',
  token_ciphertext: encrypt(token),
  token_hash: 'hash-a',
  account_id: 'account-a',
  conversation_id: 'conversation-a',
  attempts: 1,
});
const rpc = vi.fn(),
  send = vi.fn();
const db = { rpc } as unknown as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'claim_mobile_push_jobs'
        ? [{ id: 'job-a', lease_token: 'lease-a' }]
        : name === 'prepare_mobile_push_job'
          ? [prepared()]
          : true,
    error: null,
  }));
  send.mockResolvedValue({ outcome: 'accepted' });
});
it('does nothing while Firebase configuration is disabled', async () => {
  expect(await drainMobilePush(db, { config: null, send })).toMatchObject({
    configured: false,
    claimed: 0,
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('claims the configured project/app/environment and reauthorizes before decrypt/send', async () => {
  expect(await drainMobilePush(db, { config, send })).toMatchObject({
    claimed: 1,
    accepted: 1,
  });
  expect(rpc.mock.calls[0]).toEqual([
    'claim_mobile_push_jobs',
    {
      p_project: config.projectId,
      p_environment: 'development',
      p_app: config.appId,
      p_limit: 20,
    },
  ]);
  expect(rpc.mock.calls[1]).toEqual([
    'prepare_mobile_push_job',
    { p_id: 'job-a', p_lease: 'lease-a' },
  ]);
  expect(send).toHaveBeenCalledWith(token, {
    id: 'job-a',
    accountId: 'account-a',
    conversationId: 'conversation-a',
  });
  expect(rpc.mock.calls[2][1]).toMatchObject({
    p_outcome: 'accepted',
    p_lease: 'lease-a',
  });
});
it('skips jobs whose current access/preferences/quiet hours fail SQL preparation', async () => {
  rpc
    .mockResolvedValueOnce({ data: [{ id: 'job-a', lease_token: 'lease-a' }] })
    .mockResolvedValueOnce({ data: [] });
  expect(await drainMobilePush(db, { config, send })).toMatchObject({
    deferred: 1,
    accepted: 0,
  });
  expect(send).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(2);
});
it('does not send or finish a job when the authorization query fails', async () => {
  rpc
    .mockResolvedValueOnce({ data: [{ id: 'job-a', lease_token: 'lease-a' }] })
    .mockResolvedValueOnce({ error: { message: 'synthetic' } });
  expect(await drainMobilePush(db, { config, send })).toMatchObject({
    failed: 1,
  });
  expect(send).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(2);
});
it('keeps network exceptions retryable with a stable job identity and bounded backoff', async () => {
  send.mockRejectedValue(new Error('network loss'));
  expect(await drainMobilePush(db, { config, send })).toMatchObject({
    deferred: 1,
  });
  expect(rpc.mock.calls[2][1]).toMatchObject({
    p_id: 'job-a',
    p_outcome: 'retry',
    p_retry_seconds: 60,
  });
});
it('honors provider backoff and only invalidates the hash actually attempted', async () => {
  send.mockResolvedValue({ outcome: 'retry', retryAfterSeconds: 1200 });
  await drainMobilePush(db, { config, send });
  expect(rpc.mock.calls[2][1]).toMatchObject({
    p_outcome: 'retry',
    p_retry_seconds: 1200,
    p_invalid_token_hash: null,
  });
  rpc.mockClear();
  send.mockResolvedValue({ outcome: 'invalid_token' });
  await drainMobilePush(db, { config, send });
  expect(rpc.mock.calls[2][1]).toMatchObject({
    p_outcome: 'invalid_token',
    p_invalid_token_hash: 'hash-a',
  });
});
it('rejects corrupted device ciphertext before any provider request', async () => {
  rpc
    .mockResolvedValueOnce({ data: [{ id: 'job-a', lease_token: 'lease-a' }] })
    .mockResolvedValueOnce({
      data: [{ ...prepared(), token_ciphertext: 'corrupt' }],
    });
  expect(await drainMobilePush(db, { config, send })).toMatchObject({
    failed: 1,
  });
  expect(send).not.toHaveBeenCalled();
  expect(rpc.mock.calls[2][1]).toMatchObject({ p_outcome: 'rejected' });
});
it('retains the lease for recovery if provider acceptance could not be recorded', async () => {
  rpc
    .mockResolvedValueOnce({ data: [{ id: 'job-a', lease_token: 'lease-a' }] })
    .mockResolvedValueOnce({ data: [prepared()] })
    .mockResolvedValueOnce({ data: false });
  expect(await drainMobilePush(db, { config, send })).toMatchObject({
    failed: 1,
    accepted: 0,
  });
  expect(send).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledTimes(3);
});
