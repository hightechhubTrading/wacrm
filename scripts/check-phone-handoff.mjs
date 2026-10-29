/** Isolated browser checks: actual handoff UI, synthetic data, mocked APIs. */
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureRoot = await mkdtemp(join(tmpdir(), 'wacrm-phone-'));
let server;
let browser;
try {
  await symlink(
    join(project, 'node_modules'),
    join(fixtureRoot, 'node_modules')
  );
  await writeFile(
    join(fixtureRoot, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(fixtureRoot, 'can.ts'),
    'export const useCan = () => true;'
  );
  await writeFile(
    join(fixtureRoot, 'main.tsx'),
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {NextIntlClientProvider} from 'next-intl';
    import {Toaster} from 'sonner';
    import {GroupWorkDialog} from ${JSON.stringify(join(project, 'src/components/jobs/group-work.tsx'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))};
    import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};
    import ${JSON.stringify(join(project, 'src/app/design-system.css'))};
    const params = new URLSearchParams(location.search);
    const locale = params.get('locale') || 'en';
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    document.documentElement.dataset.mode = params.has('dark') ? 'dark' : 'light';
    document.documentElement.dataset.theme = 'violet';
    document.documentElement.style.setProperty('--font-sans', 'Arial');
    document.documentElement.style.setProperty('--font-arabic', 'Arial');
    if (params.has('dark')) document.documentElement.classList.add('dark');
    createRoot(document.getElementById('root')).render(
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en} timeZone="Asia/Qatar">
        <div className="crm-workspace"><GroupWorkDialog dealId="synthetic-job" initialView={params.get('view') || 'report'} onClose={() => {}} /></div>
        <Toaster />
      </NextIntlClientProvider>
    );
  `
  );
  server = await createServer({
    configFile: false,
    root: fixtureRoot,
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-can', replacement: join(fixtureRoot, 'can.ts') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [project, fixtureRoot] },
    },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let work = [];
  let writes = [];
  let failWrite = false;
  const record = (status = 'waiting') => ({
    id: 'work-1',
    deal_id: 'synthetic-job',
    reference: 42,
    kind: 'measurement',
    status,
    location: 'Synthetic site',
    details: 'Measure the entrance',
    responsible: null,
    due_at: null,
    revision: 1,
    updated_at: '2026-10-29T10:00:00Z',
    quotation_snapshot: null,
    events: [],
  });
  await page.route('**/api/jobs/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({
        json: {
          deal: {
            title: 'Synthetic measurement',
            contact: { name: 'Example', phone: null },
          },
          work,
          quotations: [],
        },
      });
    }
    writes.push({ method: request.method(), body: request.postData() });
    if (failWrite)
      return route.fulfill({
        status: 503,
        json: { error: 'Synthetic save failed' },
      });
    if (request.method() === 'POST') work = [record('draft')];
    if (request.method() === 'PATCH') work = [record('report_received')];
    return route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        window.shareCount = (window.shareCount || 0) + 1;
      },
    });
  });
  const open = async (query = '') => {
    await page.goto(`${origin}?${query}`);
    await page.getByRole('group').first().waitFor();
  };
  work = [record()];
  await open('view=report');
  assert.equal(
    await page.locator('#work-location').count(),
    0,
    'Report entry must not show preparation form'
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Measurement report received', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Save update', exact: true })
      .isDisabled(),
    true
  );
  await page
    .getByLabel('Report / explanation', { exact: true })
    .fill('Worker sent the measurements');
  failWrite = true;
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await page.getByText('Synthetic save failed', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Report / explanation', { exact: true }).inputValue(),
    'Worker sent the measurements'
  );
  failWrite = false;
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await page
    .getByText('No posted measurement request is awaiting a report.', {
      exact: false,
    })
    .waitFor();
  assert.ok(
    writes.at(-1).body.includes('name="action"\r\n\r\nreport'),
    'Report shortcut must submit report action'
  );

  work = [];
  await open('view=prepare');
  await page
    .getByLabel('Site location / map link', { exact: true })
    .fill('Synthetic site');
  await page
    .getByLabel('Products, requirements and instructions', { exact: true })
    .fill('Measure the entrance');
  await page
    .getByRole('button', { name: 'Prepare message', exact: true })
    .click();
  await page.getByText('Prepared — not posted', { exact: true }).waitFor();
  assert.equal(JSON.parse(writes.at(-1).body).kind, 'measurement');
  const beforeShare = writes.length;
  await page
    .getByRole('button', { name: 'Share message', exact: true })
    .click();
  await page.waitForFunction(() => window.shareCount === 1);
  assert.equal(writes.length, beforeShare, 'Sharing must not record posting');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('Cancelled', 'AbortError');
      },
    })
  );
  await page
    .getByRole('button', { name: 'Share message', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Share message', exact: true })
    .waitFor({ state: 'visible' });
  assert.equal(
    writes.length,
    beforeShare,
    'Cancelled sharing must not record posting'
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    })
  );
  await page
    .getByRole('button', { name: 'Share message', exact: true })
    .click();
  await page.getByText('Sharing is unavailable.', { exact: false }).waitFor();
  assert.equal(
    writes.length,
    beforeShare,
    'Unavailable sharing must not record posting'
  );
  await page.getByRole('button', { name: 'New request', exact: true }).click();
  await page
    .getByText('There is already an active request', { exact: false })
    .waitFor();
  assert.equal(
    await page.locator('#work-location').count(),
    0,
    'Prevent duplicate active measurement preparation'
  );
  await page
    .getByRole('button', { name: 'Workshop / installation', exact: true })
    .click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Prepare message', exact: true })
      .isDisabled(),
    true,
    'Workshop needs an accepted quotation'
  );

  // Bilingual light/dark layouts, including small Android-width screens.
  for (const locale of ['en', 'ar'])
    for (const width of [360, 390, 1280])
      for (const dark of [false, true]) {
        for (const view of ['prepare', 'overview', 'report']) {
          work =
            view === 'prepare'
              ? []
              : [record(view === 'overview' ? 'draft' : 'waiting')];
          await page.setViewportSize({ width, height: 844 });
          await open(`view=${view}&locale=${locale}${dark ? '&dark' : ''}`);
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            `${locale}/${width}/${dark}/${view}: horizontal overflow`
          );
          const sheet = page.locator('.crm-job-sheet');
          assert.ok(
            await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
            'Sheet must not overflow horizontally'
          );
          if (width < 640)
            assert.equal(
              Math.round(
                await sheet.evaluate((el) => el.getBoundingClientRect().width)
              ),
              width,
              'Phone handoff must use the full viewport width'
            );
          if (process.env.PHONE_CHECK_ARTIFACTS && width === 390 && !dark) {
            await mkdir(process.env.PHONE_CHECK_ARTIFACTS, { recursive: true });
            await page.screenshot({
              path: join(
                process.env.PHONE_CHECK_ARTIFACTS,
                `${locale}-${view}.png`
              ),
            });
          }
          if (view === 'prepare') {
            assert.ok(
              await page
                .locator('#work-location')
                .evaluate(
                  (el) => parseFloat(getComputedStyle(el).fontSize) >= 16
                ),
              'Avoid iOS field zoom'
            );
          }
        }
      }
  assert.deepEqual(errors, []);
  console.log(
    'Phone handoff checks passed: report routing/save/retry, request preparation, duplicate prevention, share attribution, workshop gate, 36 bilingual layouts.'
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
