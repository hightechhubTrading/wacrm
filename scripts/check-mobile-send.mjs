import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mockMobileRealtime } from './mobile-realtime-fixture.mjs';
const b = await chromium.launch({ channel: 'chrome' });
try {
  const p = await b.newPage();
  await mockMobileRealtime(p);
  let result = 'accepted',
    checks = 'unknown';
  const posts = [],
    lookups = [];
  const user = {
    id: 'user-a',
    email: 'fixture@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  await p.route('https://**/*', async (route) => {
    const r = route.request(),
      u = new URL(r.url());
    let body = {},
      status = 200;
    if (u.pathname === '/auth/v1/token')
      body = {
        access_token: 'synthetic-token',
        refresh_token: 'synthetic-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user,
      };
    else if (u.pathname === '/auth/v1/user') body = user;
    else if (u.pathname === '/rest/v1/profiles')
      body = { account_id: 'account-a', account_role: 'agent' };
    else if (u.pathname === '/rest/v1/conversations')
      body = [
        {
          id: 'conversation-a',
          contact: { name: 'Synthetic conversation', phone: '000' },
          last_message_text: 'Synthetic',
          last_message_at: new Date().toISOString(),
        },
      ];
    else if (u.pathname === '/rest/v1/messages') body = [];
    else if (u.pathname === '/api/mobile/messages') {
      assert.equal(r.headers().authorization, 'Bearer synthetic-token');
      if (r.method() === 'POST') {
        posts.push(r.postDataJSON());
        if (result === 'accepted') body = { success: true };
        else if (result === 'rejected') {
          status = 403;
          body = { outcome: 'rejected' };
        } else body = { outcome: 'unknown' };
      } else if (u.searchParams.has('operation_id')) {
        lookups.push(u.searchParams.get('operation_id'));
        body = { outcome: checks };
      } else body = { protocol: 1, textReplies: true };
    } else throw new Error('Unexpected fixture request');
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await p.goto('http://127.0.0.1:4175');
  await p.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await p.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.getByRole('button', { name: /Synthetic conversation/ }).click();
  const input = p.getByLabel('Text reply', { exact: true }),
    send = p.getByRole('button', { name: 'Send reply', exact: true });
  await input.fill('Synthetic first reply');
  await send.waitFor();
  await p.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Send reply'
      )?.disabled
  );
  await send.evaluate((el) => {
    el.click();
    el.click();
  });
  await p.getByText('Reply accepted by WhatsApp.', { exact: true }).waitFor();
  assert.equal(posts.length, 1);
  assert.equal(await input.inputValue(), '');
  result = 'unknown';
  await input.fill('Synthetic uncertain reply');
  await send.click();
  await p
    .getByText(
      'Delivery is not confirmed. Check status before sending again.',
      { exact: true }
    )
    .waitFor();
  assert.equal(posts.length, 2);
  assert(await send.isDisabled());
  assert.equal(lookups.at(-1), posts[1].operation_id);
  assert.equal(await input.inputValue(), 'Synthetic uncertain reply');
  checks = 'accepted';
  await p
    .getByRole('button', { name: 'Check delivery status', exact: true })
    .click();
  await p.getByText('Reply accepted by WhatsApp.', { exact: true }).waitFor();
  assert.equal(posts.length, 2);
  result = 'rejected';
  await input.fill('Synthetic rejected reply');
  await send.click();
  await p
    .getByText('Reply was not sent. Review your message and try again.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await input.inputValue(), 'Synthetic rejected reply');
  assert.equal(posts.length, 3);
  assert(
    posts.every(
      (x) =>
        x.message_type === 'text' &&
        x.conversation_id === 'conversation-a' &&
        x.operation_id
    )
  );
  assert.equal(new Set(posts.map((x) => x.operation_id)).size, 3);
  console.log(
    'PASS synthetic send: one POST on double click, accepted/rejected/unknown handling, preserved draft, GET-only reconciliation, stable operation ID. No real messages sent.'
  );
} finally {
  await b.close();
}
