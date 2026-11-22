import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcmTransport } from './fcm';
import { activePushConfig, pushConfig, type PushConfig } from './config';
let directory: string, config: PushConfig;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
  type: 'service_account',
  project_id: 'test-project',
  client_email: 'fixture@test-project.iam.gserviceaccount.com',
  private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const job = {
  id: 'event-a',
  bindingId: 'device-a',
  validUntil: new Date(Date.now() + 600000).toISOString(),
  accountId: 'account-a',
  conversationId: 'conversation-a',
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'push-fcm-test-'));
  config = {
    projectId: 'test-project',
    appId: 'com.hightechhub.crm.demo',
    environment: 'development',
    credentialsFile: join(directory, 'key.json'),
  };
  await writeFile(config.credentialsFile, JSON.stringify(credentials), {
    mode: 0o600,
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const oauth = () =>
  Response.json({ access_token: 'synthetic-access', token_type: 'Bearer' });
it('uses a signed scoped assertion and shares OAuth for concurrent sends; payload stays generic', async () => {
  const transport = vi.fn().mockImplementation(async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = init.body.get('assertion'),
        [header, payload, signature] = assertion.split('.');
      expect(
        JSON.parse(Buffer.from(payload, 'base64url').toString())
      ).toMatchObject({
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: url,
      });
      const verify = createVerify('RSA-SHA256');
      verify.update(`${header}.${payload}`);
      expect(
        verify.verify(keys.publicKey, Buffer.from(signature, 'base64url'))
      ).toBe(true);
      return oauth();
    }
    expect(url).toBe(
      'https://fcm.googleapis.com/v1/projects/test-project/messages:send'
    );
    expect(init.headers.Authorization).toBe('Bearer synthetic-access');
    const message = JSON.parse(init.body).message;
    expect(message.notification).toBeUndefined();
    expect(message.android.collapse_key).toBeUndefined();
    expect(message.data).toEqual({
      kind: 'crm_update',
      eventId: 'event-a',
      bindingId: 'device-a',
      validUntil: String(Date.parse(job.validUntil)),
      accountId: 'account-a',
      conversationId: 'conversation-a',
    });
    expect(message.android).toMatchObject({
      restricted_package_name: config.appId,
      priority: 'HIGH',
    });
    expect(message.android.notification).toBeUndefined();
    expect(init.redirect).toBe('error');
    return Response.json({ name: 'projects/test-project/messages/synthetic' });
  });
  const send = fcmTransport(config, transport);
  expect(
    await Promise.all([
      send('synthetic-token', job),
      send('synthetic-token', job),
    ])
  ).toEqual([{ outcome: 'accepted' }, { outcome: 'accepted' }]);
  expect(transport).toHaveBeenCalledTimes(3);
});
it.each([429, 500, 503, 401, 403])(
  'retries known transient/configuration HTTP %s errors and honors Retry-After',
  async (status) => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(
        Response.json({}, { status, headers: { 'Retry-After': '600' } })
      );
    expect(await fcmTransport(config, transport)('token', job)).toEqual({
      outcome: 'retry',
      retryAfterSeconds: 600,
    });
  }
);
it('only disables tokens on the explicit FCM unregistered result', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(oauth())
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
              },
            ],
          },
        },
        { status: 404 }
      )
    );
  expect(await fcmTransport(config, transport)('token', job)).toEqual({
    outcome: 'invalid_token',
  });
  const invalid = vi
    .fn()
    .mockResolvedValueOnce(oauth())
    .mockResolvedValueOnce(Response.json({}, { status: 400 }));
  expect(await fcmTransport(config, invalid)('token', job)).toEqual({
    outcome: 'rejected',
  });
});
it('retains uncertainty for a dropped response or malformed success', async () => {
  for (const response of [
    Promise.reject(new TypeError('network')),
    Promise.resolve(Response.json({ name: 'wrong-project' })),
  ]) {
    response.catch(() => {});
    const transport = vi
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockImplementationOnce(() => response);
    expect(await fcmTransport(config, transport)('token', job)).toEqual({
      outcome: 'retry',
    });
  }
});
it('never sends with missing or mismatched credentials', async () => {
  const transport = vi.fn();
  await writeFile(
    config.credentialsFile,
    JSON.stringify({ ...credentials, project_id: 'other-project' })
  );
  expect(await fcmTransport(config, transport)('token', job)).toEqual({
    outcome: 'retry',
  });
  expect(transport).not.toHaveBeenCalled();
});
it('configuration requires explicit project, app, environment and absolute credential path', () => {
  for (const key of [
    'FIREBASE_PROJECT_ID',
    'MOBILE_PUSH_APP_ID',
    'MOBILE_PUSH_ENVIRONMENT',
    'FIREBASE_SERVICE_ACCOUNT_FILE',
  ])
    vi.stubEnv(key, '');
  expect(pushConfig()).toBeNull();
  vi.stubEnv('FIREBASE_PROJECT_ID', config.projectId);
  vi.stubEnv('MOBILE_PUSH_APP_ID', config.appId);
  vi.stubEnv('MOBILE_PUSH_ENVIRONMENT', 'development');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', config.credentialsFile);
  expect(pushConfig()).toEqual(config);
  vi.stubEnv('MOBILE_PUSH_ENVIRONMENT', 'another');
  expect(pushConfig()).toBeNull();
});
it('requires a valid credential file before reporting push configured', async () => {
  vi.stubEnv('FIREBASE_PROJECT_ID', config.projectId);
  vi.stubEnv('MOBILE_PUSH_APP_ID', config.appId);
  vi.stubEnv('MOBILE_PUSH_ENVIRONMENT', config.environment);
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', config.credentialsFile);
  expect(await activePushConfig()).toEqual(config);
  await writeFile(
    config.credentialsFile,
    JSON.stringify({
      ...credentials,
      private_key: '-----BEGIN PRIVATE KEY----- invalid',
    })
  );
  expect(await activePushConfig()).toBeNull();
  await rm(config.credentialsFile);
  expect(await activePushConfig()).toBeNull();
});
