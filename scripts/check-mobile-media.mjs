import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { mockMobileRealtime } from './mobile-realtime-fixture.mjs';
// One second of synthetic silent Ogg/Opus; no recorded speech.
export const fixtureVoice = Buffer.from(
  'T2dnUwACAAAAAAAAAADKc/CMAAAAACv0kakBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAMpz8IwBAAAAWxGCuwE8T3B1c1RhZ3MMAAAATGF2ZjYzLjEuMTAyAQAAABwAAABlbmNvZGVyPUxhdmM2My4xLjEwMiBsaWJvcHVzT2dnUwAAgLsAAAAAAADKc/CMAgAAAPlyF4cyAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwP4//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//74//5PZ2dTAAS4vAAAAAAAAMpz8IwDAAAAFsN6SQED+P/+',
  'base64'
);

// Tiny, generated two-page PDF: no company/customer content or remote assets.
export function fixturePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 560] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 560] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...[1, 2].map((n) => {
      const s = `BT /F1 20 Tf 30 490 Td (Synthetic document - page ${n}) Tj ET`;
      return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
    }),
  ];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(data.length);
    data += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = data.length;
  data += `xref\n0 8\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
export async function installMediaFixtures(page, { realAuth = false } = {}) {
  const realtime = await mockMobileRealtime(page);
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d5e6ef';
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#d9d6ce';
    ctx.fillRect(0, 300, 600, 100);
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(75, 90, 455, 220);
    ctx.fillStyle = '#bcc3c5';
    ctx.fillRect(75, 90, 455, 14);
    ctx.fillStyle = '#36505a';
    ctx.fillRect(110, 155, 150, 155);
    ctx.fillRect(355, 150, 130, 110);
    ctx.fillStyle = '#8b7e6a';
    for (let y = 160; y < 305; y += 11) ctx.fillRect(115, y, 140, 5);
    ctx.fillStyle = '#c8dfe7';
    ctx.fillRect(362, 157, 55, 94);
    ctx.fillRect(424, 157, 54, 94);
    ctx.fillStyle = '#4f7565';
    ctx.beginPath();
    ctx.arc(38, 264, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#243b43';
    ctx.font = '14px sans-serif';
    ctx.fillText('SYNTHETIC SITE PHOTO', 335, 374);
    return c.toDataURL('image/png').split(',')[1];
  });
  const user = {
    id: 'fixture-user',
    email: 'fixture@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const messages = [
    {
      id: 'photo',
      content_type: 'image',
      media_url: '/api/whatsapp/media/123',
      content_text: 'Site photo · synthetic',
    },
    {
      id: 'pdf',
      content_type: 'document',
      media_url: '/api/whatsapp/media/124',
      content_text: 'Measurement notes.pdf',
    },
    {
      id: 'word',
      content_type: 'document',
      media_url: '/api/whatsapp/media/125',
      content_text: 'Project notes.docx',
    },
    {
      id: 'expired',
      content_type: 'image',
      media_url: '/api/whatsapp/media/126',
      content_text: 'Expired photo',
    },
    {
      id: 'missing',
      content_type: 'document',
      media_url: null,
      content_text: 'Unavailable document',
    },
    {
      id: 'voice2',
      content_type: 'audio',
      media_url: '/api/whatsapp/media/128',
      content_text: null,
    },
    {
      id: 'voice',
      content_type: 'audio',
      media_url: '/api/whatsapp/media/127',
      content_text: null,
    },
  ].map((m, i) => ({
    ...m,
    sender_type: 'customer',
    status: null,
    created_at: new Date(Date.now() - (5 - i) * 60000).toISOString(),
  }));
  let calls = 0;
  const requests = new Map();
  let expired = true;
  await page.route('https://**/*', async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.hostname === 'localhost') return route.continue(); // Packaged assets/worker.
    if (realAuth && u.pathname.startsWith('/auth/v1/')) return route.continue();
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
      body = { account_id: 'fixture-account', account_role: 'agent' };
    else if (u.pathname === '/rest/v1/conversations')
      body = [
        {
          id: 'fixture-conversation',
          contact: { name: 'Attachment test', phone: '+0000000' },
          unread_count: 0,
          last_message_text: 'Synthetic attachments',
          last_message_at: new Date().toISOString(),
        },
      ];
    else if (u.pathname === '/rest/v1/messages') body = [...messages].reverse();
    else if (u.pathname === '/api/mobile/messages' && req.method() === 'GET')
      body = { protocol: 1, textReplies: true, mediaReplies: true };
    else if (u.pathname.startsWith('/api/mobile/media/')) {
      assert.equal(req.method(), 'GET');
      assert.match(req.headers().authorization, /^Bearer /);
      calls++;
      const id = u.pathname.split('/').at(-1);
      requests.set(id, (requests.get(id) ?? 0) + 1);
      if (id === 'expired' && expired)
        return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({
        contentType: id.startsWith('voice')
          ? 'audio/ogg'
          : id === 'pdf'
            ? 'application/pdf'
            : id === 'word'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'image/png',
        body: id.startsWith('voice')
          ? fixtureVoice
          : id === 'pdf'
            ? fixturePdf()
            : id === 'word'
              ? Buffer.from('Synthetic file')
              : Buffer.from(image, 'base64'),
      });
    } else throw Error('Unexpected request in media fixture');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  return {
    realtime,
    calls: () => calls,
    requests: (id) => requests.get(id) ?? 0,
    recover: () => {
      expired = false;
    },
  };
}
export async function checkMedia(page, fixture) {
  await page.locator('button.conversation').first().click();
  await page
    .getByRole('button', { name: /View photo/ })
    .first()
    .waitFor();
  const thumbnail = page.locator('.inline-photo').first();
  await thumbnail.scrollIntoViewIfNeeded();
  await thumbnail.locator('img').waitFor();
  assert(
    await thumbnail
      .locator('img')
      .evaluate((img) => img.complete && img.naturalWidth > 0)
  );
  const imageRequests = fixture.requests('photo');
  await page
    .getByRole('button', { name: /View photo/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('img', { name: 'Site photo · synthetic' }).waitFor();
  assert.equal(
    fixture.requests('photo'),
    imageRequests,
    'Full photo reuses its authenticated thumbnail download'
  );
  assert.equal(
    await dialog
      .locator('img')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true
  );
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await dialog.getByText('150%').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page
    .getByRole('button', { name: /View document/ })
    .first()
    .click();
  await page.getByText('Page 1 of 2', { exact: true }).waitFor();
  const next = dialog.getByRole('button', { name: 'Next page', exact: true });
  await next.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Next page"]').disabled
  );
  await next.click();
  await page.getByText('Page 2 of 2', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.pdf-text')?.textContent.includes('page 2')
  );
  assert((await dialog.locator('canvas').evaluate((c) => c.width)) > 0);
  await mkdir('/tmp/wacrm-mobile-ui', { recursive: true });
  await page.screenshot({ path: '/tmp/wacrm-mobile-ui/pdf-preview.png' });
  await dialog.getByRole('button', { name: 'Close attachment' }).click();
  await page
    .getByRole('button', { name: /View document/ })
    .nth(1)
    .click();
  await dialog
    .getByText('This document opens in a compatible app on your device.')
    .waitFor();
  await dialog.getByRole('button', { name: 'Close attachment' }).click();
  assert.equal(
    await page
      .getByRole('button', { name: /View document/ })
      .last()
      .isDisabled(),
    true
  );
  const expiredPhoto = page.locator('.inline-photo').nth(1);
  await expiredPhoto.scrollIntoViewIfNeeded();
  await expiredPhoto
    .getByRole('button', { name: 'Retry photo', exact: true })
    .waitFor();
  fixture.recover();
  await expiredPhoto
    .getByRole('button', { name: 'Retry photo', exact: true })
    .click();
  await expiredPhoto.locator('img').waitFor();
  const voice = page.locator('.inline-voice').first();
  await voice.scrollIntoViewIfNeeded();
  const audio = voice.locator('audio');
  await audio.waitFor({ state: 'attached' });
  await page.waitForFunction(
    () => document.querySelector('.inline-voice audio')?.readyState >= 2
  );
  assert((await audio.evaluate((el) => el.duration)) > 0);
  await audio.evaluate((el) => {
    window.__fixturePlayer = el;
    el.muted = true;
  });
  await voice
    .getByRole('button', { name: 'Play voice message', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('.inline-voice audio')?.currentTime > 0
  );
  await voice
    .getByRole('slider', { name: 'Seek voice message', exact: true })
    .fill('0.3');
  await voice
    .getByRole('button', { name: 'Pause voice message', exact: true })
    .click();
  assert(await audio.evaluate((el) => el.paused));
  await voice
    .getByRole('button', { name: 'Playback speed 1 times', exact: true })
    .click();
  assert.equal(await audio.evaluate((el) => el.playbackRate), 1.5);
  await voice
    .getByRole('button', { name: 'Play voice message', exact: true })
    .click();
  const nextVoice = page.locator('.inline-voice').nth(1);
  await nextVoice.scrollIntoViewIfNeeded();
  await nextVoice.locator('audio').waitFor({ state: 'attached' });
  await nextVoice.locator('audio').evaluate((el) => {
    el.muted = true;
  });
  await nextVoice
    .getByRole('button', { name: 'Play voice message', exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.inline-voice audio')].some(
      (el) => !el.paused
    )
  );
  assert(
    await audio.evaluate((el) => el.paused),
    'Starting another voice pauses the previous one'
  );
  await page.screenshot({ path: '/tmp/wacrm-mobile-ui/inline-voice.png' });
  await page
    .getByRole('button', { name: 'Back to inbox', exact: true })
    .click();
  assert(
    await page.evaluate(
      () =>
        window.__fixturePlayer.paused &&
        !window.__fixturePlayer.hasAttribute('src')
    )
  );
  await page.evaluate(() => {
    delete window.__fixturePlayer;
  });
  await page.locator('button.conversation').first().click();
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
    const fixture = await installMediaFixtures(page);
    await page.goto('http://127.0.0.1:4175');
    await page
      .getByLabel('Email', { exact: true })
      .fill('fixture@example.test');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await checkMedia(page, fixture);
    assert.deepEqual(errors, []);
    console.log(
      'PASS mobile media: visible authorized thumbnails, shared photo download/zoom, 2-page PDF rendering, document fallback, expired retry, missing attachment, inline Ogg/Opus play/seek/pause/speed, single-player and chat cleanup. No live writes.'
    );
  } finally {
    await browser.close();
  }
}
