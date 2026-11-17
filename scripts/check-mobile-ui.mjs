import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { mockMobileRealtime } from './mobile-realtime-fixture.mjs';
const browser = await chromium.launch({ channel: 'chrome' });
const output = '/tmp/wacrm-mobile-ui';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const realtime = await mockMobileRealtime(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const user = {
    id: 'user-a',
    email: 'synthetic@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const names = [
    'Villa measurement',
    'أحمد — استفسار عن الأبواب',
    'Pergola enquiry',
    'Al Noor contracting',
    'Demo · Site coordination',
    'Window shutters',
  ];
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: 'conversation-' + i,
    contact: { name: names[i % names.length], phone: '+000000' + i },
    unread_count: i === 0 ? 3 : i === 1 ? 1 : 0,
    assigned_agent_id: i % 2 === 0 ? 'user-a' : 'user-b',
    status: 'open',
    last_message_text:
      i === 0
        ? 'Can we arrange a site measurement?'
        : i === 1
          ? 'ممكن معرفة خيارات الألوان المتوفرة؟'
          : 'Thank you. I will share the details.',
    last_message_at: new Date(Date.now() - i * 3600000).toISOString(),
  }));
  let messages = Array.from({ length: 30 }, (_, i) => ({
    id: 'message-' + i,
    sender_type: i % 3 === 0 ? 'agent' : 'customer',
    status: 'read',
    content_type: 'text',
    content_text:
      i === 29
        ? 'شكراً، ممكن نحدد موعد للقياس؟'
        : i % 3 === 0
          ? 'Of course. Please share the approximate opening dimensions.'
          : 'I would like to discuss the shutter options for our villa.',
    created_at: new Date(Date.now() - (30 - i) * 60000).toISOString(),
  }));
  await page.route('https://**/*', async (route) => {
    const r = route.request(),
      u = new URL(r.url());
    let body;
    if (u.pathname === '/auth/v1/token')
      body = {
        access_token: 'fixture-token',
        refresh_token: 'fixture-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user,
      };
    else if (u.pathname === '/auth/v1/user') body = user;
    else if (u.pathname === '/rest/v1/profiles')
      body = { account_id: 'account-a', account_role: 'agent' };
    else if (u.pathname === '/rest/v1/conversations') body = rows;
    else if (/^\/api\/mobile\/conversations\/[^/]+\/read$/.test(u.pathname)) {
      assert.equal(r.method(), 'POST');
      const row = rows.find((c) => c.id === u.pathname.split('/').at(-2));
      if (row) row.unread_count = 0;
      body = { read: true };
    } else if (u.pathname === '/rest/v1/messages')
      body = [...messages].reverse();
    else if (u.pathname === '/api/mobile/messages' && r.method() === 'GET')
      body = { protocol: 1, textReplies: true };
    else
      throw new Error(
        'Unexpected fixture request (sending is prohibited in visual QA)'
      );
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('http://127.0.0.1:4175');
  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.conversation').first().waitFor();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: `${output}/inbox-${width}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Unread/ }).click();
  assert.equal(await page.locator('.conversation').count(), 2);
  await page.locator('.conversation').first().click();
  await page.getByRole('region', { name: 'Reply', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  assert.equal(
    await page
      .getByRole('button', { name: /^Unread/ })
      .getAttribute('aria-pressed'),
    'true'
  );
  await page
    .getByRole('button', { name: 'Assigned to me', exact: true })
    .click();
  assert.equal(await page.locator('.conversation').count(), 13);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('searchbox').fill('no-such-match');
  await page
    .getByRole('heading', { name: 'No matching conversations' })
    .waitFor();
  await page.getByRole('button', { name: 'Clear search' }).click();
  assert.equal(await page.locator('.conversation').count(), 25);
  await page.locator('.inbox-scroll').evaluate((el) => {
    el.scrollTop = 650;
  });
  await page.waitForTimeout(100);
  await page.locator('.conversation').nth(8).click();
  await page.getByRole('region', { name: 'Reply', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await page.waitForTimeout(100);
  assert(
    (await page.locator('.inbox-scroll').evaluate((el) => el.scrollTop)) > 500
  );
  await page.locator('.conversation').first().click();
  await page.getByRole('region', { name: 'Reply', exact: true }).waitFor();
  await page.getByRole('status').waitFor({ state: 'detached' });
  await page.waitForTimeout(100);
  const input = page.getByLabel('Text reply', { exact: true });
  await input.fill('Thank you. Let me check the available measurement times.');
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await page.locator('.conversation').first().click();
  assert.equal(
    await input.inputValue(),
    'Thank you. Let me check the available measurement times.'
  );
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/conversation.png` });
  await page.locator('.transcript').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  messages = [
    ...messages,
    {
      id: 'message-new',
      sender_type: 'customer',
      status: 'delivered',
      content_type: 'text',
      content_text: 'Synthetic new message',
      created_at: new Date().toISOString(),
    },
  ];
  realtime.emit('messages');
  await page
    .getByRole('button', { name: 'New messages', exact: true })
    .waitFor();
  assert(
    (await page.locator('.transcript').evaluate((el) => el.scrollTop)) < 80
  );
  await page.getByRole('button', { name: 'New messages', exact: true }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.transcript');
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  });
  await page.setViewportSize({ width: 390, height: 420 });
  await input.focus();
  await page.waitForTimeout(100);
  const box = await input.boundingBox();
  assert(
    await page
      .locator('.transcript')
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 3),
    'Keyboard-sized viewport stays pinned to latest message'
  );
  const send = await page
    .getByRole('button', { name: 'Send reply', exact: true })
    .boundingBox();
  assert(
    box &&
      send &&
      box.y >= 0 &&
      box.y + box.height <= 420 &&
      send.y + send.height <= 420
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await page.screenshot({ path: `${output}/keyboard-height.png` });
  await page.locator('.transcript').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(60);
  await page.setViewportSize({ width: 390, height: 550 });
  await page.waitForTimeout(100);
  assert(
    (await page.locator('.transcript').evaluate((el) => el.scrollTop)) < 80,
    'Resizing preserves older-message reading position'
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS mobile UX: 320/390/430 widths, filters/search, filter + scroll restoration, draft preservation, new-message jump, keyboard-height composer, no runtime errors. Synthetic records only.'
  );
} finally {
  await browser.close();
}
