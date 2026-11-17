import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { activePushConfig, type PushConfig } from './config';
import {
  fcmTransport,
  type FcmOutcome,
  type FcmResult,
  type PushMessage,
} from './fcm';

interface Prepared {
  job_id: string;
  device_id: string;
  token_ciphertext: string;
  token_hash: string;
  account_id: string;
  conversation_id: string | null;
  attempts: number;
}
export async function drainMobilePush(
  db: SupabaseClient,
  options: {
    config?: PushConfig | null;
    send?: (token: string, message: PushMessage) => Promise<FcmResult>;
  } = {}
) {
  const config =
    options.config === undefined ? await activePushConfig() : options.config;
  const result = {
    configured: !!config,
    claimed: 0,
    accepted: 0,
    deferred: 0,
    failed: 0,
  };
  if (!config) return result;
  const send = options.send ?? fcmTransport(config);
  const { data, error } = await db.rpc('claim_mobile_push_jobs', {
    p_project: config.projectId,
    p_environment: config.environment,
    p_app: config.appId,
    p_limit: 20,
  });
  if (error) throw new Error('Push queue unavailable');
  result.claimed = (data ?? []).length;
  await Promise.all(
    (data ?? []).map(async (lease: { id: string; lease_token: string }) => {
      try {
        const ready = await db.rpc('prepare_mobile_push_job', {
          p_id: lease.id,
          p_lease: lease.lease_token,
        });
        if (ready.error) throw new Error('Push authorization unavailable');
        const job: Prepared | undefined = ready.data?.[0];
        if (!job) {
          result.deferred++;
          return;
        }
        let outcome: FcmOutcome = 'rejected';
        let token: string | null = null;
        let retryAfterSeconds = 0;
        try {
          const decoded = decrypt(job.token_ciphertext);
          if (/^[A-Za-z0-9_:\-]{20,4096}$/.test(decoded)) token = decoded;
        } catch {
          /* Corrupt ciphertext cannot authorize a provider request. */
        }
        if (token) {
          try {
            const delivered = await send(token, {
              id: job.job_id,
              accountId: job.account_id,
              conversationId: job.conversation_id,
            });
            outcome = delivered.outcome;
            retryAfterSeconds = delivered.retryAfterSeconds ?? 0;
          } catch {
            outcome = 'retry';
          }
        }
        const finished = await db.rpc('finish_mobile_push_job', {
          p_id: job.job_id,
          p_lease: lease.lease_token,
          p_outcome: outcome,
          p_retry_seconds: Math.max(
            retryAfterSeconds,
            Math.min(900, 60 * 2 ** Math.max(0, job.attempts - 1))
          ),
          p_invalid_token_hash:
            outcome === 'invalid_token' ? job.token_hash : null,
        });
        if (finished.error || finished.data !== true)
          throw new Error('Push recording unavailable');
        if (outcome === 'accepted') result.accepted++;
        else if (outcome === 'retry') result.deferred++;
        else result.failed++;
      } catch {
        result.failed++; /* Lease expires for recovery, with a stable notification tag. */
      }
    })
  );
  return result;
}
