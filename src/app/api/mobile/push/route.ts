import { createHash } from 'node:crypto';
import {
  mobileAccount,
  mobilePreflight,
  mobileResponse,
} from '@/lib/mobile/conversation';
import { canSendMessages } from '@/lib/auth/roles';
import { isOperationId } from '@/lib/whatsapp/send-operations';
import { encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit } from '@/lib/rate-limit';
import { activePushConfig } from '@/lib/mobile/push/config';

export const OPTIONS = mobilePreflight;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const defaults = {
  enabled: true,
  quietStart: null,
  quietEnd: null,
  timezone: 'Asia/Qatar',
};
function response(request: Request, status: number, body: unknown) {
  return mobileResponse(request, Response.json(body, { status }));
}
export async function GET(request: Request) {
  try {
    const access = await mobileAccount(request);
    if ('response' in access) return access.response;
    const config = await activePushConfig();
    const eligible = canSendMessages(access.profile.account_role);
    if (!eligible)
      return response(request, 200, {
        configured: !!config,
        eligible,
        preferences: defaults,
      });
    const pref = await supabaseAdmin()
      .from('mobile_push_preferences')
      .select('enabled,quiet_start,quiet_end,timezone')
      .eq('user_id', access.user.id)
      .eq('account_id', access.profile.account_id)
      .maybeSingle();
    if (pref.error)
      return response(request, 503, {
        error: 'Notification settings unavailable',
      });
    return response(request, 200, {
      configured: !!config,
      eligible,
      appId: config?.appId ?? null,
      projectId: config?.projectId ?? null,
      environment: config?.environment ?? null,
      preferences: pref.data
        ? {
            enabled: pref.data.enabled,
            quietStart: pref.data.quiet_start,
            quietEnd: pref.data.quiet_end,
            timezone: pref.data.timezone,
          }
        : defaults,
    });
  } catch {
    return response(request, 503, {
      error: 'Notification settings unavailable',
    });
  }
}
async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim() !==
    'application/json'
  )
    throw new Error('body');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.length;
      if (total > 8192) {
        await reader.cancel();
        throw new Error('size');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  );
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('body');
  return value;
}
export async function POST(request: Request) {
  const fail = (status: number, error: string) =>
    response(request, status, { error });
  if (
    request.headers.has('origin') &&
    request.headers.get('origin') !== 'https://localhost'
  )
    return fail(403, 'Origin not allowed');
  let body: Record<string, unknown>;
  try {
    body = await boundedBody(request);
  } catch (e) {
    return fail(
      e instanceof Error && e.message === 'size' ? 413 : 400,
      'Invalid notification request'
    );
  }
  const allowed =
    body.action === 'revoke'
      ? ['action', 'id', 'secret']
      : body.action === 'register'
        ? ['action', 'id', 'secret', 'token', 'version', 'appId', 'projectId']
        : body.action === 'preferences'
          ? ['action', 'enabled', 'quietStart', 'quietEnd', 'timezone']
          : [];
  if (!allowed.length || Object.keys(body).some((k) => !allowed.includes(k)))
    return fail(400, 'Invalid notification request');
  if (
    body.action !== 'preferences' &&
    (!isOperationId(body.id) ||
      typeof body.secret !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.secret))
  )
    return fail(400, 'Invalid device binding');
  try {
    // A device-specific revocation capability still works after JWT/session expiry.
    // It cannot read settings, change ownership or register a new token.
    if (body.action === 'revoke') {
      if (
        !checkRateLimit('push-revoke:global', { limit: 300, windowMs: 60000 })
          .success ||
        !checkRateLimit(`push-revoke:${body.id}`, {
          limit: 30,
          windowMs: 60000,
        }).success
      )
        return fail(429, 'Try again shortly');
      const revoked = await supabaseAdmin().rpc('revoke_mobile_push_device', {
        p_id: body.id,
        p_secret_hash: hash(body.secret as string),
      });
      if (revoked.error) return fail(503, 'Device revocation unavailable');
      return response(request, 200, { revoked: true }); // Never reveal whether a binding exists.
    }
    const access = await mobileAccount(request);
    if ('response' in access) return access.response;
    if (!canSendMessages(access.profile.account_role))
      return fail(403, 'Notifications require an agent role');
    if (
      !checkRateLimit(`push:${access.user.id}`, { limit: 30, windowMs: 60000 })
        .success
    )
      return fail(429, 'Try again shortly');
    if (body.action === 'preferences') {
      if (
        typeof body.enabled !== 'boolean' ||
        typeof body.timezone !== 'string' ||
        body.timezone.length > 100 ||
        ![body.quietStart, body.quietEnd].every(
          (x) =>
            x === null ||
            (Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= 1439)
        ) ||
        (body.quietStart === null) !== (body.quietEnd === null)
      )
        return fail(400, 'Invalid quiet hours');
      try {
        new Intl.DateTimeFormat('en', { timeZone: body.timezone }).format();
      } catch {
        return fail(400, 'Invalid timezone');
      }
      const updated = await supabaseAdmin().rpc('set_mobile_push_preferences', {
        p_account: access.profile.account_id,
        p_user: access.user.id,
        p_enabled: body.enabled,
        p_quiet_start: body.quietStart,
        p_quiet_end: body.quietEnd,
        p_timezone: body.timezone,
      });
      if (updated.error || updated.data !== true)
        return fail(409, 'Account access or settings changed');
      return response(request, 200, { saved: true });
    }
    const config = await activePushConfig();
    if (!config)
      return fail(503, 'Android notifications are not configured yet');
    if (
      body.appId !== config.appId ||
      body.projectId !== config.projectId ||
      typeof body.token !== 'string' ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 1 ||
      Number(body.version) > 2147483647 ||
      !/^[A-Za-z0-9_:\-]{20,4096}$/.test(body.token)
    )
      return fail(400, 'Device configuration does not match this CRM');
    let sessionId: unknown;
    try {
      // Auth.getUser already verified this exact bearer; SQL checks the actual session.
      const jwt = request.headers.get('authorization')!.slice(7);
      sessionId = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString()
      ).session_id;
    } catch {
      return fail(401, 'Please sign in again');
    }
    if (!isOperationId(sessionId)) return fail(401, 'Please sign in again');
    const registered = await supabaseAdmin().rpc(
      'register_mobile_push_device',
      {
        p_id: body.id,
        p_account: access.profile.account_id,
        p_user: access.user.id,
        p_session: sessionId,
        p_secret_hash: hash(body.secret as string),
        p_token_hash: hash(body.token),
        p_ciphertext: encrypt(body.token),
        p_project: config.projectId,
        p_app: config.appId,
        p_environment: config.environment,
        p_version: body.version,
      }
    );
    if (registered.error || registered.data !== true)
      return fail(
        409,
        'Device binding or account changed. Disable and enable notifications again.'
      );
    return response(request, 200, { registered: true });
  } catch {
    return fail(503, 'Notification update unavailable');
  }
}
