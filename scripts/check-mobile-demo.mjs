import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const outbound = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4175/')) outbound.push(r.url());
  });
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('button', { name: 'Explore demo inbox' }).click();
  await page.getByRole('button', { name: 'Explore demo inbox' }).click();
  await page.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
  await page.getByRole('searchbox').fill('no-match');
  await page.getByText('No conversations match your search.').waitFor();
  await page.getByRole('searchbox').fill('Pergola');
  await page.getByRole('button', { name: /Demo · Pergola enquiry/ }).click();
  await page
    .getByRole('region', { name: 'Message history' })
    .getByText('مرحبا، هل تتوفر خيارات لسقف متحرك؟', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: /Demo · Villa measurement/ }).click();
  assert.equal(await page.locator('.message').count(), 3);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await page.screenshot({ path: '/tmp/wacrm-mobile-demo.png' });
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  console.log(
    'PASS: demo entry, search/empty state, Arabic/English history, back navigation, mobile width, no runtime errors or external requests.'
  );
} finally {
  await browser.close();
}
