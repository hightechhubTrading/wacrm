import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { installMediaFixtures } from './check-mobile-media.mjs';
import { validVoiceOgg } from '../src/lib/inbox/voice-format.ts';
export async function checkVoice(page, { realAuth = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A generated silent audio stream, never the host microphone. Exercise the real
  // encoder worker and preview decoder without capturing personal speech.
  const initScript = await page.addInitScript(() => {
    window.__originalVoiceCapture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );
    window.__voiceStreams = [];
    window.__denyVoice = false;
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__denyVoice)
        throw new DOMException('Synthetic denial', 'NotAllowedError');
      const context = new AudioContext();
      await context.resume();
      const source = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0;
      const dest = context.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(dest);
      source.start();
      window.__voiceStreams.push({ stream: dest.stream, context });
      return dest.stream;
    };
  });
  try {
    await installMediaFixtures(page, { realAuth });
    let uploads = 0,
      sends = 0,
      lookup = 0,
      outcome = 'accepted',
      reconciliation = 'unknown';
    let uploaded;
    await page.route('**/api/mobile/messages*', (r) => {
      const req = r.request();
      let body;
      if (req.method() === 'GET')
        body = new URL(req.url()).searchParams.has('operation_id')
          ? (lookup++, { outcome: reconciliation })
          : {
              protocol: 1,
              textReplies: true,
              mediaReplies: true,
              voiceReplies: true,
            };
      else {
        const data = req.postDataJSON();
        assert.equal(data.message_type, 'audio');
        assert.equal(data.content_text, '');
        assert.match(data.filename, /\.ogg$/);
        sends++;
        body = outcome === 'accepted' ? { success: true } : { outcome };
      }
      return r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.route('**/api/mobile/uploads', async (r) => {
      uploads++;
      const body = r.request().postDataBuffer();
      const at = body.indexOf(Buffer.from('OggS'));
      assert(at >= 0, 'Upload contains real encoded Ogg');
      const end = body.lastIndexOf(Buffer.from('\r\n--'));
      uploaded = body.subarray(at, end);
      assert(validVoiceOgg(uploaded));
      return r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'audio',
          filename: 'voice.ogg',
          mediaUrl:
            'https://fixture.supabase.co/storage/v1/object/public/chat-media/voice.ogg',
        }),
      });
    });
    if (realAuth) await page.reload();
    else {
      await page.goto('http://127.0.0.1:4175');
      await page
        .getByLabel('Email', { exact: true })
        .fill('fixture@example.test');
      await page
        .getByLabel('Password', { exact: true })
        .fill('fixture-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.locator('button.conversation').click();
    const record = page.getByRole('button', {
        name: 'Record voice message',
        exact: true,
      }),
      stop = page.getByRole('button', { name: 'Stop recording', exact: true });
    await record.click();
    await stop.waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Stop recording"]').disabled
    );
    await page.waitForTimeout(850);
    await stop.click();
    const preview = page.getByLabel('Recorded voice preview', { exact: true });
    await preview.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Recorded voice preview"]')
          .readyState >= 2
    );
    await page.screenshot({
      path: '/tmp/wacrm-mobile-ui/voice-recording-preview.png',
    });
    assert.equal(uploads, 0);
    assert.equal(sends, 0);
    assert.equal(
      await page.getByLabel('Text reply', { exact: true }).isVisible(),
      false
    );
    await preview.evaluate(async (a) => {
      a.muted = true;
      await a.play();
    });
    await preview.evaluate((a) => a.pause());
    await page
      .getByRole('button', { name: 'Send reply', exact: true })
      .dblclick();
    await page
      .getByText('Reply accepted by WhatsApp.', { exact: true })
      .waitFor();
    assert.equal(uploads, 1);
    assert.equal(sends, 1);
    await record.click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Stop recording"]').disabled
    );
    await page
      .getByRole('button', { name: 'Discard recording', exact: true })
      .click();
    await record.waitFor();
    assert.equal(await preview.count(), 0);
    assert.equal(uploads, 1);
    await record.click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Stop recording"]').disabled
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event('hth:cancel-recording'))
    );
    await record.waitFor();
    assert(
      await page.evaluate(() =>
        window.__voiceStreams.every(({ stream }) =>
          stream.getTracks().every((t) => t.readyState === 'ended')
        )
      )
    );
    await page.evaluate(() => (window.__denyVoice = true));
    await record.click();
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => (window.__denyVoice = false));
    outcome = 'unknown';
    await record.click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Stop recording"]').disabled
    );
    await page.waitForTimeout(700);
    await stop.click();
    await preview.waitFor();
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await page
      .getByRole('button', { name: 'Check delivery status', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Send reply', exact: true })
        .isDisabled(),
      true
    );
    const sent = sends;
    reconciliation = 'accepted';
    await page
      .getByRole('button', { name: 'Check delivery status', exact: true })
      .click();
    await page
      .getByText('Reply accepted by WhatsApp.', { exact: true })
      .waitFor();
    assert.equal(sends, sent);
    assert(lookup > 0);
    assert.deepEqual(errors, []);
    await page.evaluate(async () => {
      await Promise.all(
        window.__voiceStreams.map(({ context }) => context.close())
      );
    });
    console.log(
      'PASS voice: real mono Ogg/Opus encoding/decoding from generated silence, preview before upload, explicit tracked send, double-click guard, discard, lifecycle mic cleanup, permission denial and unknown-outcome reconciliation. No microphone capture or live sends.'
    );
  } finally {
    await initScript.dispose();
    await page
      .evaluate(async () => {
        if (window.__originalVoiceCapture)
          navigator.mediaDevices.getUserMedia = window.__originalVoiceCapture;
        for (const e of window.__voiceStreams ?? []) {
          for (const t of e.stream.getTracks()) t.stop();
          if (e.context.state !== 'closed') await e.context.close();
        }
        delete window.__voiceStreams;
        delete window.__denyVoice;
        delete window.__originalVoiceCapture;
      })
      .catch(() => {});
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await checkVoice(
      await browser.newPage({ viewport: { width: 390, height: 844 } })
    );
  } finally {
    await browser.close();
  }
}
