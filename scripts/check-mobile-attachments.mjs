import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installMediaFixtures } from './check-mobile-media.mjs';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installMediaFixtures(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [],
    uploads = [],
    lookups = [];
  let holdUpload = false,
    releaseUpload;
  let outcome = 'accepted',
    uploadFails = false,
    reconcile = 'unknown';
  await page.route('**/api/mobile/messages*', async (route) => {
    const req = route.request();
    let body;
    if (req.method() === 'POST') {
      const data = req.postDataJSON();
      posts.push(data);
      body = outcome === 'accepted' ? { success: true } : { outcome };
    } else if (new URL(req.url()).searchParams.has('operation_id')) {
      lookups.push(new URL(req.url()).searchParams.get('operation_id'));
      body = { outcome: reconcile };
    } else body = { protocol: 1, textReplies: true, mediaReplies: true };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.route('**/api/mobile/uploads', async (route) => {
    assert.equal(route.request().method(), 'POST');
    assert.equal(
      route.request().headers().authorization,
      'Bearer fixture-token'
    );
    assert.match(
      route.request().headers()['content-type'],
      /^multipart\/form-data;/
    );
    uploads.push(route.request().postDataBuffer());
    if (holdUpload)
      await new Promise((resolve) => {
        releaseUpload = resolve;
      });
    await route.fulfill({
      status: uploadFails ? 502 : 201,
      contentType: 'application/json',
      body: JSON.stringify(
        uploadFails
          ? { error: 'Upload did not finish. No message was sent.' }
          : {
              kind: photo ? 'image' : 'document',
              mediaUrl:
                'https://fixture.supabase.co/storage/v1/object/public/chat-media/fixture-file',
              filename: photo ? 'photo.png' : 'notes.pdf',
            }
      ),
    });
  });
  let photo = true;
  await page.goto('http://127.0.0.1:4175');
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('button.conversation').first().click();
  const picker = page.getByLabel('Choose photo or document', { exact: true });
  await page.waitForFunction(
    () => !document.querySelector('input[type="file"]').disabled
  );
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 100;
      const x = c.getContext('2d');
      x.fillStyle = '#e0d9cb';
      x.fillRect(0, 0, 100, 100);
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64'
  );
  await picker.setInputFiles({
    name: 'unsafe.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('fixture'),
  });
  await page
    .getByText('Choose a JPG/PNG photo, PDF, Office document or text file.', {
      exact: true,
    })
    .waitFor();
  assert.equal(uploads.length, 0);
  await picker.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await page
    .getByText('Photos must be 5 MB or smaller.', { exact: true })
    .waitFor();
  assert.equal(uploads.length, 0);
  const pickPhoto = () =>
    picker.setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: png,
    });
  const pickDocument = () =>
    picker.setInputFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fixture'),
    });
  await pickPhoto();
  await page.getByRole('img', { name: 'Selected photo preview' }).waitFor();
  assert.equal(uploads.length, 0, 'Choosing a file does not upload/send');
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
  }
  const input = page.getByLabel('Text reply', { exact: true });
  const send = page.getByRole('button', { name: 'Send reply', exact: true });
  await input.fill('Synthetic photo caption');
  await send.evaluate((el) => {
    el.click();
    el.click();
  });
  await page
    .getByText('Reply accepted by WhatsApp.', { exact: true })
    .waitFor();
  assert.equal(uploads.length, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].message_type, 'image');
  assert.equal(posts[0].content_text, 'Synthetic photo caption');
  assert.equal(posts[0].filename, 'photo.png');
  assert.equal(await page.locator('.selected-attachment').count(), 0);
  photo = false;
  uploadFails = true;
  await pickDocument();
  await send.click();
  await page
    .getByText('Upload did not finish. No message was sent.', { exact: true })
    .waitFor();
  assert.equal(posts.length, 1);
  assert.equal(await page.locator('.selected-attachment').count(), 1);
  uploadFails = false;
  outcome = 'unknown';
  await send.click();
  await page
    .getByText(
      'Delivery is not confirmed. Check status before sending again.',
      { exact: true }
    )
    .waitFor();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].message_type, 'document');
  assert.equal(lookups.at(-1), posts[1].operation_id);
  assert(await send.isDisabled());
  await page
    .getByRole('button', { name: 'Back to inbox', exact: true })
    .click();
  await page.locator('button.conversation').first().click();
  await page.getByText('notes.pdf', { exact: true }).last().waitFor();
  assert(
    await page
      .getByRole('button', { name: 'Remove attachment', exact: true })
      .isDisabled()
  );
  reconcile = 'accepted';
  await page
    .getByRole('button', { name: 'Check delivery status', exact: true })
    .click();
  await page
    .getByText('Reply accepted by WhatsApp.', { exact: true })
    .waitFor();
  assert.equal(posts.length, 2);
  assert.equal(await page.locator('.selected-attachment').count(), 0);
  outcome = 'rejected';
  await pickDocument();
  await input.fill('Document caption');
  await send.click();
  await page
    .getByText('Reply was not sent. Review your message and try again.', {
      exact: true,
    })
    .waitFor();
  const uploadedCount = uploads.length;
  outcome = 'accepted';
  await send.click();
  await page
    .getByText('Reply accepted by WhatsApp.', { exact: true })
    .waitFor();
  assert.equal(
    uploads.length,
    uploadedCount,
    'Rejected sends reuse the completed upload'
  );
  assert.notEqual(posts.at(-1).operation_id, posts.at(-2).operation_id);
  assert.equal(posts.at(-1).media_url, posts.at(-2).media_url);
  holdUpload = true;
  outcome = 'unknown';
  reconcile = 'unknown';
  const before = posts.length;
  await pickDocument();
  await input.fill('First upload caption');
  await send.click();
  await page.getByText('Uploading attachment…', { exact: true }).waitFor();
  await page.waitForTimeout(50);
  await page
    .getByRole('button', { name: 'Back to inbox', exact: true })
    .click();
  await page.locator('button.conversation').first().click();
  await input.fill('New draft while the old upload completes');
  await send.click();
  await page
    .getByText('Another reply is finishing. Please wait before sending.', {
      exact: true,
    })
    .waitFor();
  assert.equal(posts.length, before);
  releaseUpload();
  holdUpload = false;
  await page.waitForFunction(
    (n) => window.performance.now() > n,
    await page.evaluate(() => performance.now() + 300)
  );
  assert.equal(posts.length, before + 1);
  await send.click();
  await page
    .getByText('A reply has an unresolved status. Check it before sending.', {
      exact: true,
    })
    .waitFor();
  assert.equal(posts.length, before + 1);
  reconcile = 'accepted';
  await page
    .getByRole('button', { name: 'Check delivery status', exact: true })
    .click();
  await page
    .getByText('Reply accepted by WhatsApp.', { exact: true })
    .waitFor();
  assert.equal(
    await input.inputValue(),
    'New draft while the old upload completes'
  );
  await page
    .getByRole('button', { name: 'Back to inbox', exact: true })
    .click();
  await page.locator('button.conversation').first().click();
  assert.equal(
    await input.inputValue(),
    'New draft while the old upload completes'
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS attachments: local preview, type/size validation, 320/390/430 widths, one upload/send on double click, upload failure sends nothing, unknown recovery after navigation, rejected retry reuses upload. No live writes.'
  );
} finally {
  await browser.close();
}
