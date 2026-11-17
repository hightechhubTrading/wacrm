import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mockMobileRealtime } from './mobile-realtime-fixture.mjs';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.install();
  const realtime = await mockMobileRealtime(page);
  const traffic = [];
  const errors = [];
  let receipt = null;
  let preview = 'Fixture message',
    history = 'Fixture history',
    sessionInvalid = false;
  page.on('pageerror', (e) => errors.push(e.message));
  let rejectLogin = true,
    forbidden = false,
    hidden = false;
  const user = {
    id: '20000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'fake@example.test',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  await page.route('https://**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    traffic.push([req.method(), url.pathname]);
    let body = {},
      status = 200;
    if (url.pathname === '/api/mobile/messages') {
      body = { protocol: 1, textReplies: false };
    } else if (url.pathname === '/auth/v1/token') {
      if (rejectLogin) {
        status = 400;
        body = {
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
        };
      } else
        body = {
          access_token: 'test-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'test-refresh',
          user,
        };
    } else if (url.pathname === '/auth/v1/user') {
      if (sessionInvalid) {
        status = 401;
        body = { message: 'invalid token' };
      } else body = user;
    } else if (url.pathname === '/auth/v1/logout') {
      status = 204;
    } else if (url.pathname === '/rest/v1/profiles')
      body = forbidden
        ? null
        : { account_id: 'account-a', account_role: 'agent' };
    else if (url.pathname === '/rest/v1/conversations') {
      if (url.searchParams.has('id')) {
        assert.equal(url.searchParams.get('id'), 'eq.conversation-a');
        body = hidden
          ? null
          : {
              id: 'conversation-a',
              contact: { name: 'Synthetic person', phone: '000' },
              last_message_text: preview,
              last_message_at: new Date().toISOString(),
            };
      } else {
        assert.equal(url.searchParams.get('limit'), '100');
        body = hidden
          ? []
          : [
              {
                id: 'conversation-a',
                contact: { name: 'Synthetic person', phone: '000' },
                last_message_text: preview,
                last_message_at: new Date().toISOString(),
              },
            ];
      }
    } else if (url.pathname === '/rest/v1/messages') {
      assert.equal(url.searchParams.get('limit'), '50');
      body = [
        {
          id: 'message-a',
          sender_type: 'customer',
          content_text: history,
          content_type: 'text',
          status: 'read',
          created_at: new Date().toISOString(),
        },
        ...(receipt === null
          ? []
          : [
              {
                id: 'outgoing-fixture',
                sender_type: 'agent',
                content_text: 'Outgoing fixture',
                content_type: 'text',
                status: receipt,
                created_at: new Date().toISOString(),
              },
            ]),
      ];
    } else throw new Error('Unexpected route ' + url.pathname);
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 204 ? '' : JSON.stringify(body),
    });
  });
  await page.goto('http://127.0.0.1:4175');
  const signIn = async () => {
    await page.getByLabel('Email', { exact: true }).fill('fake@example.test');
    await page.getByLabel('Password', { exact: true }).fill('fake-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  await signIn();
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page.getByLabel('Password', { exact: true }).inputValue(),
    ''
  );
  assert(!traffic.some(([, p]) => p.startsWith('/rest/')));
  rejectLogin = false;
  await signIn();
  await page.getByRole('button', { name: /Synthetic person/ }).click();
  await page.getByText('Fixture history', { exact: true }).waitFor();
  assert.equal(await page.locator('.incoming').count(), 1);
  await page
    .getByText('Live updates connected', { exact: true })
    .waitFor({ state: 'attached' });
  const beforeEvents = traffic.length;
  assert.equal(await page.locator('.delivery').count(), 0);
  receipt = 'sent';
  history = 'Realtime history';
  realtime.emit('messages');
  realtime.emit('messages');
  realtime.emit('messages');
  await page.getByText('Realtime history', { exact: true }).waitFor();
  assert.equal(await page.locator('.message').count(), 2);
  await page
    .locator('.delivery')
    .getByText('Sent', { exact: true })
    .waitFor({ state: 'attached' });
  assert(traffic.length - beforeEvents < 10, 'burst should coalesce reads');
  for (const [state, label] of [
    ['delivered', 'Delivered'],
    ['read', 'Read'],
    ['failed', 'Failed'],
    ['sending', 'Sending'],
    ['future-status', 'Status unavailable'],
  ]) {
    receipt = state;
    realtime.emit('messages');
    await page
      .locator('.delivery')
      .getByText(label, { exact: true })
      .waitFor({ state: 'attached' });
  }

  history = 'Polling recovery';
  await page.clock.runFor(31000);
  await page.getByText('Polling recovery', { exact: true }).waitFor();
  // Browser network lifecycle recovery uses the same invalidation path as native resume.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page
    .getByText('Offline. Updates will resume when connected.', { exact: true })
    .waitFor();
  preview = 'Recovered preview';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page
    .getByText('Live updates connected', { exact: true })
    .waitFor({ state: 'attached' });
  hidden = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  assert.equal(
    await page.getByText('Fixture history', { exact: true }).count(),
    0
  );

  await page.getByLabel('Chat options', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(
    await page.getByText('Fixture history', { exact: true }).count(),
    0
  );
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  forbidden = true;
  await signIn();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Your account access is unavailable.' })
    .waitFor();
  assert.equal(
    await page.getByText('Synthetic person', { exact: true }).count(),
    0
  );
  assert(
    traffic.every(
      ([method, path]) => method === 'GET' || path.startsWith('/auth/v1/')
    )
  );
  // Revoked/invalid auth must hide data and return to sign-in.
  sessionInvalid = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign in to your CRM' }).waitFor();
  assert.equal(await page.locator('.conversation').count(), 0);
  assert.equal(await page.locator('.message').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS mocked transport: invalid login, password clearing, authorized history, customer direction, sign-out cleanup, memory-only session, missing membership denied, no database writes. Realtime burst/reconnect and invalid-session handling passed. No live credentials used.'
  );
} finally {
  await browser.close();
}
