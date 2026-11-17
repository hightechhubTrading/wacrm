import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { installMediaFixtures } from './check-mobile-media.mjs';
export async function checkContactPhotos(page, { realAuth = false } = {}) {
  await installMediaFixtures(page, { realAuth });
  const id = '12345678-1234-4234-8234-123456789abc';
  const versions = [
    '22345678-1234-4234-8234-123456789abc',
    '32345678-1234-4234-8234-123456789abc',
    '42345678-1234-4234-8234-123456789abc',
  ];
  let src = `/api/contacts/${id}/photo?v=${versions[0]}`;
  let calls = 0,
    denied = false,
    foreign = 0;
  const image = await sharp({
    create: { width: 256, height: 256, channels: 3, background: '#286da8' },
  })
    .webp()
    .toBuffer();
  await page.route('**/rest/v1/conversations*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'fixture-conversation',
          contact: {
            id,
            name: 'Synthetic Person',
            phone: '+0000000',
            avatar_url: src,
          },
          unread_count: 0,
          last_message_text: 'Synthetic photo verification',
          last_message_at: new Date().toISOString(),
        },
      ]),
    })
  );
  await page.route('**/api/contacts/*/photo*', (route) => {
    assert.match(route.request().headers().authorization, /^Bearer /);
    calls++;
    return route.fulfill({
      status: denied ? 403 : 200,
      contentType: 'image/webp',
      body: denied ? Buffer.from('{}') : image,
    });
  });
  await page.route('https://foreign.example.test/**', (route) => {
    foreign++;
    return route.abort();
  });
  return {
    image,
    async run() {
      const decoded = () =>
        page.waitForFunction(() =>
          [...document.querySelectorAll('.person-avatar img')].some(
            (i) => i.complete && i.naturalWidth === 256
          )
        );
      await decoded();
      assert.equal(calls, 1);
      await page.locator('button.conversation').first().click();
      await decoded();
      assert.equal(calls, 1, 'Thread reuses cached download');
      await page
        .getByRole('button', { name: 'Back to inbox', exact: true })
        .click();
      src = `/api/contacts/${id}/photo?v=${versions[1]}`;
      const oldPhoto = await page
        .locator('.person-avatar img')
        .first()
        .getAttribute('src');
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(
        (old) => document.querySelector('.person-avatar img')?.src !== old,
        oldPhoto
      );
      await decoded();
      assert.equal(calls, 2, 'Version change downloads replacement');
      src = null;
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.locator('.person-avatar img').waitFor({ state: 'detached' });
      assert(
        (await page.locator('.person-avatar').first().textContent()).includes(
          'SP'
        )
      );
      denied = true;
      src = `/api/contacts/${id}/photo?v=${versions[2]}`;
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(versions[2])),
        page.getByRole('button', { name: 'Refresh', exact: true }).click(),
      ]);
      assert.equal(await page.locator('.person-avatar img').count(), 0);
      src = 'https://foreign.example.test/photo.webp';
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.locator('button.conversation').first().click();
      await page
        .getByRole('button', { name: 'Back to inbox', exact: true })
        .click();
      assert.equal(
        foreign,
        0,
        'Foreign URLs never receive requests or user credentials'
      );
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fixture = await checkContactPhotos(page);
    await page.goto('http://127.0.0.1:4175');
    await page
      .getByLabel('Email', { exact: true })
      .fill('fixture@example.test');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await fixture.run();
    assert.deepEqual(errors, []);
    console.log(
      'PASS mobile contact photos: authenticated decode, shared cache, replacement refresh, removal, denied fallback, foreign-source protection. Synthetic fixtures; no live writes.'
    );
  } finally {
    await browser.close();
  }
}
