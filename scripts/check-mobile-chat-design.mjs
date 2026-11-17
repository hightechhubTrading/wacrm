import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { installMediaFixtures } from './check-mobile-media.mjs';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fixture = await installMediaFixtures(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const source = [
    {
      id: 'text1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'مرحباً، ممكن نعمل نفس تصميم الباب؟',
    },
    {
      id: 'photo',
      sender_type: 'customer',
      content_type: 'image',
      media_url: '/api/whatsapp/media/123',
      content_text: null,
    },
    {
      id: 'text2',
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'Yes, let’s check the dimensions first.',
      status: 'read',
    },
    {
      id: 'voice',
      sender_type: 'customer',
      content_type: 'audio',
      media_url: '/api/whatsapp/media/127',
      content_text: null,
    },
    {
      id: 'pdf',
      sender_type: 'agent',
      content_type: 'document',
      media_url: '/api/whatsapp/media/124',
      content_text: 'Measurement guide.pdf',
      status: 'delivered',
    },
  ].map((m, i) => ({
    status: null,
    media_url: null,
    ...m,
    created_at: new Date(Date.now() - (5 - i) * 60000).toISOString(),
  }));
  await page.route('**/rest/v1/messages*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([...source].reverse()),
    })
  );
  await page.goto('http://127.0.0.1:4175');
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('button.conversation').first().click();
  await page.locator('.inline-photo img').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.inline-voice audio')?.readyState >= 2
  );
  await mkdir('/tmp/wacrm-mobile-ui', { recursive: true });
  for (const size of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
    const send = await page
      .getByRole('button', { name: 'Send reply', exact: true })
      .boundingBox();
    assert(send && send.y + send.height <= size.height && send.height >= 44);
    await page.screenshot({
      path: `/tmp/wacrm-mobile-ui/chat-redesign-${size.width}.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const before = fixture.requests('photo');
  await page.getByRole('button', { name: 'View photo', exact: true }).click();
  await page.getByRole('dialog').locator('img').waitFor();
  assert.equal(fixture.requests('photo'), before);
  await page
    .getByRole('button', { name: 'Close attachment', exact: true })
    .click();
  await page.getByLabel('Chat options', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.locator('details.account-menu').getAttribute('open'),
    null
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS chat redesign: inline image/audio, shared preview request, portrait/landscape widths, composer bounds, functional options menu, no runtime errors. Synthetic data only.'
  );
} finally {
  await browser.close();
}
