/** Fixture-only regression: no live account, AI call or WhatsApp send is used. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { startSupabaseFixture } from './performance/supabase-fixture.mjs';
const backend = await startSupabaseFixture({
  size: 5,
  latency: 0,
  port: Number(process.env.INBOX_TEST_BACKEND_PORT || 0),
});
const origin = 'http://127.0.0.1:3098';
const output = process.env.INBOX_TEST_OUTPUT || '/tmp/wacrm-inbox-responsive';
await mkdir(output, { recursive: true });
const summary =
  'The customer needs a shutter door quotation and is waiting for a team member to confirm the measurements and price.';
backend.tables.contacts[0].name =
  'Modern eastern trading and contracting — customer with a long company name';
backend.tables.conversations[0].ai_context_summary = summary;
let logs = '';
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: backend.origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
  ENCRYPTION_KEY: '0'.repeat(64),
  META_APP_SECRET: 'fixture-only',
  NEXT_PUBLIC_SITE_URL: origin,
  AI_WORK_POLL_ENABLED: 'false',
  META_CAPI_ENABLED: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
};
let child;
function launch(args) {
  const childProcess = spawn(
    globalThis.process.execPath,
    ['node_modules/next/dist/bin/next', ...args],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  childProcess.stdout.on('data', (d) => {
    logs += d;
  });
  childProcess.stderr.on('data', (d) => {
    logs += d;
  });
  return childProcess;
}
let browser;
const results = [];
const sizes = [
  [1536, 730, 320],
  [1366, 650, 260],
  [1280, 600, 220],
  [1920, 950, 450],
  [390, 844, 0],
  [768, 1024, 0],
  [1399, 730, 0],
  [1400, 730, 0],
  [1536, 819, 0],
  [1536, 820, 0],
  [1920, 819, 0],
  [1920, 820, 0],
  [1675, 950, 0],
  [1676, 950, 0],
  [390, 400, 0],
  [768, 365, 0],
  [1023, 730, 0],
  [1024, 730, 0],
];
try {
  if (
    process.env.INBOX_TEST_PRODUCTION === '1' &&
    process.env.INBOX_TEST_SKIP_BUILD !== '1'
  ) {
    console.log('Building fixture-backed production app');
    const build = launch(['build', '--webpack']);
    await new Promise((resolve, reject) => {
      build.on('error', reject);
      build.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error('Production build failed; see next.log'))
      );
    });
  }
  child = launch([
    process.env.INBOX_TEST_PRODUCTION === '1' ? 'start' : 'dev',
    ...(process.env.INBOX_TEST_PRODUCTION === '1' ? [] : ['--webpack']),
    '--port',
    '3098',
    '--hostname',
    '127.0.0.1',
  ]);
  let ready = false;
  for (let n = 0; n < 90; n++) {
    try {
      if ((await fetch(origin + '/login')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready, 'Application did not start');
  browser =
    process.env.INBOX_TEST_BROWSER === 'webkit'
      ? await webkit.launch({ headless: true })
      : await chromium.launch({
          headless: true,
          channel: process.env.INBOX_TEST_CHANNEL || 'chrome',
        });
  for (const [role, locale, theme, mode] of [
    ['admin', 'en', 'navy-gold', 'dark'],
    ['owner', 'en', 'navy-gold', 'dark'],
    ['admin', 'ar', 'rose', 'light'],
    ['agent', 'ar', 'emerald', 'dark'],
    ['viewer', 'en', 'violet', 'light'],
  ]) {
    if (
      process.env.INBOX_TEST_SINGLE_SCENARIO === '1' &&
      (role !== 'admin' || locale !== 'en')
    )
      continue;
    Object.assign(backend.tables.profiles[0], {
      account_role: role,
      locale,
      theme,
      mode,
    });
    const context = await browser.newContext({
      viewport: { width: 1536, height: 730 },
    });
    await context.addCookies([
      { name: 'wacrm.locale', value: locale, url: origin },
      {
        name: 'sb-127-auth-token',
        value:
          'base64-' +
          Buffer.from(JSON.stringify(backend.session())).toString('base64url'),
        url: origin,
      },
    ]);
    const page = await context.newPage();
    const runtimeErrors = [];
    const canceledRequests = new Set();
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || '';
      if (/cancel|abort/i.test(failure))
        canceledRequests.add(request.url().replace(/^https?:\/\//, ''));
      else console.log('Failed fixture request:', failure, request.url());
    });
    let navigating = false;
    const navigationCancellations = [];
    page.on('pageerror', (error) => {
      // WebKit reports canceled cross-origin fixture fetches as native errors
      // while destroying a document. Keep steady-state failures in the assertion.
      if (
        navigating &&
        process.env.INBOX_TEST_BROWSER === 'webkit' &&
        error.stack?.startsWith('Fetch API cannot load ' + backend.origin) &&
        error.stack?.includes('due to access control checks.')
      ) {
        navigationCancellations.push(error.message);
        return;
      }
      runtimeErrors.push({
        message: error.message,
        nativeFetch:
          !error.stack || error.stack.startsWith('Fetch API cannot load '),
      });
      console.log('Browser runtime error:', error.stack);
    });
    const reloadPage = async () => {
      await page.waitForLoadState('networkidle');
      navigating = true;
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
      } finally {
        navigating = false;
      }
      await page.waitForLoadState('networkidle');
    };
    for (const [width, height, minimum] of sizes) {
      await page.setViewportSize({ width, height });
      const conversationUrl =
        origin + '/inbox?c=' + backend.tables.conversations[0].id;
      if (page.url() !== conversationUrl) {
        navigating = true;
        try {
          await page.goto(conversationUrl, { waitUntil: 'domcontentloaded' });
        } finally {
          navigating = false;
        }
      }
      await page
        .locator(
          role === 'viewer'
            ? '.crm-followup-load-preview[role=alert]'
            : '.crm-followup-overview'
        )
        .waitFor({
          timeout: 60000,
          state: height <= 560 ? 'attached' : 'visible',
        });
      await page.locator('.crm-message-column').waitFor();
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(() => {
        const thread = document.querySelector('.crm-thread');
        if (!thread) return false;
        const expected =
          thread.getBoundingClientRect().width < 1000 ||
          !matchMedia('(min-height: 820px)').matches;
        return thread.hasAttribute('data-compact') === expected;
      });
      const geometry = await page.evaluate(() => {
        const bounds = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        return {
          availableHeight: innerHeight,
          visualViewportHeight: visualViewport?.height,
          threadWidth: document
            .querySelector('.crm-thread')
            .getBoundingClientRect().width,
          roomyHeight: matchMedia('(min-height: 820px)').matches,
          messages: bounds('.crm-message-scroll'),
          composer: bounds('.crm-composer'),
          header: bounds('.crm-thread-header'),
          ai: bounds('.crm-transcript > .crm-ai-note'),
          details: bounds('.crm-details-pane'),
          compact: !!document.querySelector('.crm-ai-note-launcher'),
          overflow: document.documentElement.scrollWidth > innerWidth,
          theme: document.documentElement.dataset.theme,
          mode: document.documentElement.dataset.mode,
        };
      });
      const label = `${role}/${locale}/${theme}/${width}x${height}`;
      console.log(label, Math.round(geometry.messages.height) + 'px messages');
      results.push({ label, ...geometry });
      assert(!geometry.overflow, label + ': horizontal page overflow');
      assert.equal(
        geometry.compact,
        geometry.threadWidth < 1000 || !geometry.roomyHeight,
        label + ': layout mode does not match available space'
      );
      assert(
        geometry.messages.height >= minimum,
        `${label}: messages ${geometry.messages.height}px < ${minimum}px`
      );
      assert(
        geometry.composer.bottom <= height + 1,
        label + ': composer below viewport'
      );
      assert(
        geometry.messages.bottom <= geometry.composer.y + 1,
        label + ': composer overlaps messages'
      );
      assert(
        geometry.messages.width > 0,
        label + ': message pane has no width'
      );
      if (geometry.ai) {
        assert(
          geometry.ai.x >= geometry.messages.right - 1 ||
            geometry.ai.right <= geometry.messages.x + 1,
          label + ': AI overlaps messages'
        );
      }
      if (width >= 1024 && width < 1400)
        assert(
          !geometry.details?.width,
          label + ': inline contact pane should be hidden'
        );
      if (role === 'admin' && [1536, 390, 1920].includes(width))
        await page.screenshot({
          path: `${output}/${locale}-${width}-${height}.png`,
        });
      if (width === 1536 && height === 730) {
        const launcher = page.locator('.crm-ai-note-launcher');
        await launcher.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.locator('.crm-ai-note').waitFor();
        assert(
          (await dialog.textContent()).includes(summary),
          'Full note missing from assistant sheet'
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('crm-ai-note-launcher')
        );
        if (role !== 'viewer') {
          const input = page.locator('.crm-compose-row textarea');
          await input.fill('Draft survives a responsive layout change');
          await page.setViewportSize({ width: 1280, height: 600 });
          assert.equal(
            await input.inputValue(),
            'Draft survives a responsive layout change'
          );
          await input.fill('');
          await page.setViewportSize({ width, height });
        }
      }
    }
    if (role === 'admin' && locale === 'en') {
      await page.setViewportSize({ width: 1536, height: 730 });
      const baseline = {
        available: true,
        followups: [],
        latestEvent: null,
        conversation: { assigned_agent_id: null, ai_autoreply_disabled: true },
      };
      let response = baseline;
      let status = 200;
      await page.route('**/api/ai/followups/*', (route) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(response),
        })
      );
      for (const scenario of ['overdue', 'unavailable', 'failed']) {
        status = scenario === 'failed' ? 503 : 200;
        response = {
          ...baseline,
          available: scenario !== 'unavailable',
          followups:
            scenario === 'overdue'
              ? [
                  {
                    id: '90000000-0000-0000-0000-000000000001',
                    kind: 'quotation',
                    status: 'open',
                    owner_id: null,
                    source_message_id: null,
                    due_at: new Date(Date.now() - 86400000).toISOString(),
                    requested_at: null,
                    confirmed_at: null,
                    completion_evidence: null,
                  },
                ]
              : [],
        };
        await reloadPage();
        if (scenario === 'failed') {
          await page
            .locator('.crm-followup-load-preview[role=alert]')
            .waitFor();
          assert.equal(
            await page.locator('.crm-followup-status').count(),
            0,
            'Failed service displayed a task count'
          );
        } else {
          await page.locator('.crm-followup-overview').waitFor();
          if (scenario === 'overdue') {
            await page.locator('.crm-followup-status[data-overdue]').waitFor();
            assert(
              (
                await page.locator('.crm-followup-preview-text').textContent()
              ).includes('Overdue')
            );
          } else
            assert(
              (
                await page.locator('.crm-followup-status').textContent()
              ).includes('unavailable')
            );
        }
      }
      await page.unroute('**/api/ai/followups/*');
      await reloadPage();
      await page.locator('.crm-followup-overview').waitFor();
      const input = page.locator('.crm-compose-row textarea');
      await input.fill('A multiline draft\n'.repeat(12));
      assert(
        (await input.boundingBox()).height <= 100,
        'Draft grows without a height bound'
      );
      await input.fill('Customer details must not clear this draft');
      await page.setViewportSize({ width: 1280, height: 600 });
      const en = JSON.parse(
        await (
          await import('node:fs/promises')
        ).readFile('messages/en.json', 'utf8')
      ).Inbox.messageThread;
      await page
        .getByRole('button', { name: en.showContactPanel, exact: true })
        .click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(
        await input.inputValue(),
        'Customer details must not clear this draft'
      );
      await input.fill('');
      const stored = await page.evaluate(() =>
        localStorage.getItem('wacrm:inbox:contact-panel-open')
      );
      await page.setViewportSize({ width: 1920, height: 950 });
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem('wacrm:inbox:contact-panel-open')
        ),
        stored,
        'Responsive mode overwrote contact preference'
      );
      backend.tables.ai_sales_assistance = [
        {
          conversation_id: backend.tables.conversations[0].id,
          status: 'ready',
          analysis: {
            summary: 'Prepared quotation guidance',
            action: 'reply',
            tags: [],
            fields: [],
            preview: false,
          },
        },
      ];
      await page.route('**/api/ai/draft', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ draft: 'Fixture prepared reply' }),
        })
      );
      await page.setViewportSize({ width: 1536, height: 730 });
      await reloadPage();
      await page.locator('.crm-ai-note-launcher').click();
      await page
        .getByRole('dialog')
        .locator('.crm-sales-assistance button')
        .click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(
        () =>
          document.querySelector('.crm-compose-row textarea')?.value ===
          'Fixture prepared reply'
      );
      await page.waitForFunction(
        () =>
          document.querySelector('.crm-compose-row textarea') ===
          document.activeElement
      );
      await input.fill('');
      const catalogs = JSON.parse(
        await (
          await import('node:fs/promises')
        ).readFile('messages/en.json', 'utf8')
      );
      await page.route('**/api/whatsapp/send*', (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            outcome: 'rejected',
            code: 'fixture_rejected',
          }),
        })
      );
      await input.fill('Keep this draft after a failed send');
      await page
        .getByRole('button', {
          name: catalogs.Inbox.composer.sendMessage,
          exact: true,
        })
        .click();
      await page
        .getByRole('button', {
          name: catalogs.Inbox.composer.editFailedMessage,
          exact: true,
        })
        .waitFor();
      assert.equal(
        await input.inputValue(),
        'Keep this draft after a failed send'
      );
      await page
        .getByRole('button', {
          name: catalogs.Inbox.composer.editFailedMessage,
          exact: true,
        })
        .click();
      await input.fill('');
      const pixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
        'base64'
      );
      await page.route(backend.origin + '/storage/v1/**', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'image/png',
              body: pixel,
            })
          : route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ Key: 'chat-media/fixture.png' }),
            })
      );
      await page.locator('input[type=file]').first().setInputFiles({
        name: 'fixture.png',
        mimeType: 'image/png',
        buffer: pixel,
      });
      await page.locator('.crm-composer img[alt="fixture.png"]').waitFor();
      await page
        .getByRole('button', {
          name: catalogs.Inbox.composer.sendMessage,
          exact: true,
        })
        .waitFor();
      await page
        .getByRole('button', {
          name: catalogs.Inbox.composer.removeAttachment,
          exact: true,
        })
        .click();
      await input.waitFor();
      console.log(
        'PASS failed-send draft recovery and attachment preview/remove'
      );
      const timestamps = backend.tables.messages.map((m) => m.created_at);
      backend.tables.messages.forEach((m) => {
        m.created_at = new Date(Date.now() - 48 * 3600000).toISOString();
      });
      await reloadPage();
      await page.locator('.crm-session-notice').waitFor();
      assert(
        await input.isDisabled(),
        'Expired session permits a free-text reply'
      );
      assert(
        await page.locator('.crm-session-notice button').isVisible(),
        'Expired session lost template access'
      );
      backend.tables.messages.forEach((m, i) => {
        m.created_at = timestamps[i];
      });
      backend.tables.ai_sales_assistance = [];
      console.log(
        'PASS follow-up states, bounded draft, contact drawer, prepared-reply focus and expired-session template access'
      );
    }
    const steadyErrors = runtimeErrors
      .filter(
        (error) =>
          !(
            error.nativeFetch &&
            [...canceledRequests].some((url) => error.message.includes(url))
          )
      )
      .map((error) => error.message);
    assert.deepEqual(
      steadyErrors,
      [],
      `${role}/${locale}: browser runtime errors`
    );
    if (navigationCancellations.length)
      console.log(
        `WebKit document teardown: ${navigationCancellations.length} native fixture-fetch cancellations`
      );
    await context.close();
  }
  const primary = (r) =>
    sizes.slice(0, 6).some(([w, h]) => r.label.endsWith(`/${w}x${h}`));
  const owner = results.filter(
    (r) => r.label.startsWith('owner/en') && primary(r)
  );
  const admin = results.filter(
    (r) => r.label.startsWith('admin/en') && primary(r)
  );
  owner.forEach((r, i) =>
    assert.deepEqual(
      r.messages,
      admin[i].messages,
      'Owner/admin layout differs'
    )
  );
  console.log(
    `PASS ${results.length} viewport/role/locale/theme cases, note access, focus return and draft preservation`
  );
  console.log(
    JSON.stringify(
      results
        .filter((r) => r.label.startsWith('admin/en'))
        .map((r) => ({
          case: r.label,
          messageHeight: r.messages.height,
          compact: r.compact,
        })),
      null,
      2
    )
  );
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await writeFile(`${output}/next.log`, logs);
  if (browser) await browser.close();
  child?.kill('SIGTERM');
  await backend.close();
}
