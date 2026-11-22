import { createSign } from 'node:crypto';
import { pushCredentials, type PushConfig } from './config';

export interface PushMessage {
  id: string;
  bindingId: string;
  validUntil: string;
  accountId: string;
  conversationId: string | null;
}
export type FcmOutcome = 'accepted' | 'retry' | 'rejected' | 'invalid_token';
export interface FcmResult {
  outcome: FcmOutcome;
  retryAfterSeconds?: number;
}
const oauthUrl = 'https://oauth2.googleapis.com/token';

/** One transport per drain, with one shared OAuth exchange for concurrent jobs. */
export function fcmTransport(
  config: PushConfig,
  transport: typeof fetch = fetch
) {
  let bearer: Promise<string> | null = null;
  async function authorize() {
    const credentials = await pushCredentials(config);
    const now = Math.floor(Date.now() / 1000);
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    const claims = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: credentials.email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: oauthUrl,
      iat: now,
      exp: now + 3600,
    })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(claims);
    const assertion = `${claims}.${signer.sign(credentials.privateKey).toString('base64url')}`;
    const response = await transport(oauthUrl, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new Error('Push authorization unavailable');
    const data = await response.json();
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      data.token_type?.toLowerCase() !== 'bearer'
    )
      throw new Error('Push authorization unavailable');
    return data.access_token as string;
  }
  return async (token: string, job: PushMessage): Promise<FcmResult> => {
    try {
      if(!Number.isFinite(Date.parse(job.validUntil))||Date.parse(job.validUntil)<=Date.now())return {outcome:'rejected'};
      const access = await (bearer ??= authorize());
      const ttl=Math.min(600,Math.floor((Date.parse(job.validUntil)-Date.now())/1000));
      if(ttl<=0)return {outcome:'rejected'};
      const response = await transport(
        `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
        {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              data: {
                kind: 'crm_update',
                eventId: job.id,
                bindingId: job.bindingId,
                validUntil: String(Date.parse(job.validUntil)),
                accountId: job.accountId,
                conversationId: job.conversationId ?? '',
              },
              android: {
                restricted_package_name: config.appId,
                priority: 'HIGH',
                ttl: `${ttl}s`,
                // Independent conversation updates must survive offline queuing.
                // Native conversation tags still replace visible cards.

              },
            },
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (response.ok)
        return {
          outcome:
            typeof data?.name === 'string' &&
            data.name.startsWith(`projects/${config.projectId}/messages/`)
              ? 'accepted'
              : 'retry',
        };
      if (
        data?.error?.details?.some(
          (d: { '@type'?: string; errorCode?: string }) =>
            d['@type'] ===
              'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
            d.errorCode === 'UNREGISTERED'
        )
      )
        return { outcome: 'invalid_token' };
      if (response.status === 401) bearer = null;
      const raw = response.headers.get('retry-after');
      const retryAfterSeconds = raw
        ? /^\d+$/.test(raw)
          ? Number(raw)
          : (Date.parse(raw) - Date.now()) / 1000
        : undefined;
      return {
        outcome:
          response.status === 429 ||
          response.status >= 500 ||
          [401, 403].includes(response.status)
            ? 'retry'
            : 'rejected',
        ...(Number.isFinite(retryAfterSeconds)
          ? {
              retryAfterSeconds: Math.max(
                60,
                Math.min(3600, Math.ceil(retryAfterSeconds!))
              ),
            }
          : {}),
      };
    } catch {
      // OAuth/network/parse loss is uncertain, never proof of acceptance.
      bearer = null;
      return { outcome: 'retry' };
    }
  };
}
