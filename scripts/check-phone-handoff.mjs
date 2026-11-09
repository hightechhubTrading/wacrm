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
    join(fixtureRoot, 'link.tsx'),
    'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}'
  );
  await writeFile(
    join(fixtureRoot, 'main.tsx'),
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {NextIntlClientProvider} from 'next-intl';
    import {Toaster} from 'sonner';
    import {GroupWorkDialog} from ${JSON.stringify(join(project, 'src/components/jobs/group-work.tsx'))};
    import {CompanyCalendar} from ${JSON.stringify(join(project, 'src/components/jobs/company-calendar.tsx'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))};
    import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};
    import ${JSON.stringify(join(project, 'src/app/workspace.css'))};
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
        <div className="crm-workspace" data-mode={params.has('dark')?'dark':'light'}>{params.has('calendar')?<main className="crm-main h-full overflow-y-auto"><CompanyCalendar/></main>:<GroupWorkDialog dealId="synthetic-job" initialView={params.get('view') || 'report'} onClose={() => {}} />}</div>
        <Toaster />
      </NextIntlClientProvider>
    );
  `
  );
  server = await createServer({
    cacheDir: join(fixtureRoot, '.vite-cache'),
    configFile: false,
    root: fixtureRoot,
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-can', replacement: join(fixtureRoot, 'can.ts') },
        { find: 'next/link', replacement: join(fixtureRoot, 'link.tsx') },
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
  let appointments = [],
    unscheduled = [],
    failCalendar = false;
  const people = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      user_id: '20000000-0000-4000-8000-000000000001',
      full_name: 'Requester',
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      user_id: '20000000-0000-4000-8000-000000000002',
      full_name: 'Sales colleague',
    },
  ];
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Qatar',
  });
  const nextDay = new Date(today + 'T12:00:00Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const tomorrow = nextDay.toISOString().slice(0, 10);
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
    if (new URL(request.url()).pathname === '/api/jobs/appointments') {
      if (request.method() === 'GET')
        return route.fulfill({
          status: failCalendar ? 503 : 200,
          json: {
            appointments,
            unscheduled,
            people,
            defaultResponsibleId: people[0].id,
            hasMore: false,
          },
        });
      writes.push({ method: request.method(), body: request.postData() });
      const body = request.postDataJSON();
      const legacy = unscheduled.find((work) => work.id === body.handoffId);
      appointments = appointments.map((a) =>
        a.handoff_id === body.handoffId
          ? {
              ...a,
              starts_at: body.starts_at,
              ends_at: body.ends_at,
              responsible_profile_id: body.responsible_profile_id,
              revision: a.revision + 1,
            }
          : a
      );
      if (legacy) {
        appointments.push({
          id: 'legacy-booking',
          deal_id: legacy.deal_id,
          handoff_id: legacy.id,
          kind: legacy.kind === 'measurement' ? 'visit' : 'installation',
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          status: 'reserved',
          responsible_profile_id: body.responsible_profile_id,
          responsible_name: 'Requester',
          revision: 0,
          work: {
            reference: legacy.reference,
            kind: legacy.kind,
            status: legacy.status,
            location: legacy.location,
            deal: legacy.deal,
          },
        });
        unscheduled = unscheduled.filter((work) => work.id !== legacy.id);
      }
      return route.fulfill({ json: { id: 'appointment-1' } });
    }
    if (request.method() === 'GET') {
      return route.fulfill({
        json: {
          deal: {
            title: 'Synthetic measurement',
            contact: { name: 'Example', phone: null },
          },
          work,
          quotations: [],
          preparation: {
            people,
            defaultResponsibleId: people[0].id,
            customerLocation: {
              value:
                'Customer entrance — https://www.google.com/maps?q=25.2,51.5',
              messageId: 'pin-1',
              receivedAt: new Date().toISOString(),
            },
          },
        },
      });
    }
    writes.push({ method: request.method(), body: request.postData() });
    if (failWrite)
      return route.fulfill({
        status: 503,
        json: { error: 'Synthetic save failed' },
      });
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      work = [
        {
          ...record('draft'),
          responsible: people.find((p) => p.id === body.responsible_profile_id)
            ?.full_name,
          responsible_profile_id: body.responsible_profile_id,
          due_at: body.starts_at,
          appointment: {
            id: 'appointment-1',
            starts_at: body.starts_at,
            ends_at: body.ends_at,
            status: 'reserved',
            revision: 0,
          },
        },
      ];
    }
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
  assert.equal(
    await page.locator('#work-location').inputValue(),
    'Customer entrance — https://www.google.com/maps?q=25.2,51.5'
  );
  assert.ok(
    (
      await page
        .getByRole('combobox', { name: 'Responsible CRM member' })
        .innerText()
    ).includes('Requester')
  );
  await page
    .getByLabel('Site location / map link', { exact: true })
    .fill('Synthetic site');
  await page
    .getByLabel('Products, requirements and instructions', { exact: true })
    .fill('باب');
  await page.getByText('Add 7 more characters', { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Prepare message', exact: true })
      .isDisabled(),
    true,
    'A short requirement should explain why preparation is disabled'
  );
  await page
    .getByLabel('Products, requirements and instructions', { exact: true })
    .fill('Measure the entrance');
  assert.equal(
    await page
      .getByRole('button', { name: 'Prepare message', exact: true })
      .isDisabled(),
    true,
    'Preparing requires an available appointment'
  );
  appointments = [
    {
      id: 'other-booking',
      starts_at: `${tomorrow}T06:00:00Z`,
      ends_at: `${tomorrow}T07:00:00Z`,
      status: 'reserved',
    },
    {
      id: 'later-booking',
      starts_at: `${tomorrow}T08:00:00Z`,
      ends_at: `${tomorrow}T09:00:00Z`,
      status: 'reserved',
    },
  ];
  await page
    .getByRole('button', { name: 'Appointment date', exact: true })
    .click();
  await page.locator(`[data-date="${tomorrow}"]`).click();
  await page.getByRole('combobox', { name: 'Start time', exact: true }).click();
  assert.equal(
    await page
      .getByRole('option', { name: '09:00 · Unavailable', exact: true })
      .getAttribute('aria-disabled'),
    'true',
    'Company reservations disable overlapping time choices'
  );
  await page.getByRole('option', { name: '10:00', exact: true }).click();
  await page.getByText('Available · ends', { exact: false }).waitFor();
  await page.getByLabel('Duration (minutes)', { exact: true }).fill('120');
  await page
    .getByText('This time overlaps another company appointment.', {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Prepare message', exact: true })
      .isDisabled(),
    true
  );
  await page.getByLabel('Duration (minutes)', { exact: true }).fill('60');
  await page.getByText('Available · ends', { exact: false }).waitFor();
  await page.getByRole('combobox', { name: 'Responsible CRM member' }).click();
  await page
    .getByRole('option', { name: 'Sales colleague', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Prepare message', exact: true })
    .click();
  await page.getByText('Prepared — not posted', { exact: true }).waitFor();
  assert.equal(JSON.parse(writes.at(-1).body).kind, 'measurement');
  assert.equal(
    JSON.parse(writes.at(-1).body).responsible_profile_id,
    people[1].id
  );
  assert.equal(
    JSON.parse(writes.at(-1).body).starts_at,
    `${tomorrow}T07:00:00.000Z`,
    '10:00 Qatar must reserve 07:00 UTC'
  );
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
  assert.equal(
    await page.locator('#work-location').inputValue(),
    'Synthetic site',
    'Reloading work must preserve a manually corrected location'
  );

  // Calendar presents the same reservations and can reschedule/book older work.
  appointments = [
    {
      id: 'calendar-booking',
      handoff_id: 'work-calendar',
      deal_id: 'synthetic-job',
      kind: 'visit',
      starts_at: `${today}T06:00:00Z`,
      ends_at: `${today}T07:00:00Z`,
      responsible_profile_id: people[0].id,
      responsible_name: 'Requester',
      status: 'reserved',
      revision: 0,
      work: {
        reference: 42,
        kind: 'measurement',
        status: 'waiting',
        location: 'Customer site',
        deal: { title: 'Synthetic visit' },
      },
    },
    {
      id: 'hidden-booking',
      starts_at: `${today}T08:00:00Z`,
      ends_at: `${today}T09:00:00Z`,
      status: 'reserved',
    },
  ];
  unscheduled = [
    {
      ...record(),
      id: 'legacy-work',
      reference: 43,
      deal: { title: 'Earlier request' },
    },
  ];
  await page.goto(`${origin}?calendar=1`);
  await page
    .getByRole('heading', { name: 'Company calendar', exact: true })
    .waitFor();
  await page
    .getByText('Busy · another company appointment', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await page
    .getByRole('button', { name: 'Appointment date', exact: true })
    .click();
  await page.locator(`[data-date="${tomorrow}"]`).click();
  await page.getByRole('combobox', { name: 'Start time', exact: true }).click();
  await page.getByRole('option', { name: '13:00', exact: true }).click();
  await page.getByRole('button', { name: 'Reserve time', exact: true }).click();
  await page
    .locator('[data-slot="dialog-content"]')
    .waitFor({ state: 'hidden' });
  assert.equal(JSON.parse(writes.at(-1).body).revision, 0);
  assert.equal(
    JSON.parse(writes.at(-1).body).starts_at,
    `${tomorrow}T10:00:00.000Z`
  );
  await page
    .getByRole('button', { name: 'Reserve a time', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Appointment date', exact: true })
    .click();
  await page.locator(`[data-date="${tomorrow}"]`).click();
  await page.getByRole('combobox', { name: 'Start time', exact: true }).click();
  await page.getByRole('option', { name: '14:00', exact: true }).click();
  await page.getByRole('button', { name: 'Reserve time', exact: true }).click();
  await page
    .locator('[data-slot="dialog-content"]')
    .waitFor({ state: 'hidden' });
  assert.equal(unscheduled.length, 0);
  assert.equal(
    JSON.parse(writes.at(-1).body).responsible_profile_id,
    people[0].id
  );
  failCalendar = true;
  work = [];
  await open('view=prepare');
  await page
    .getByText('Could not verify availability.', { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Prepare message', exact: true })
      .isDisabled(),
    true
  );
  failCalendar = false;

  // Bilingual light/dark layouts, including small Android-width screens.
  for (const locale of ['en', 'ar'])
    for (const width of [360, 390, 1280])
      for (const dark of [false, true]) {
        for (const view of ['prepare', 'overview', 'report', 'calendar']) {
          work =
            view === 'prepare'
              ? []
              : [record(view === 'overview' ? 'draft' : 'waiting')];
          await page.setViewportSize({
            width,
            height: width >= 1024 ? 600 : 844,
          });
          await open(
            `${view === 'calendar' ? 'calendar=1' : `view=${view}`}&locale=${locale}${dark ? '&dark' : ''}`
          );
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            `${locale}/${width}/${dark}/${view}: horizontal overflow`
          );
          if (view === 'calendar') {
            await page
              .getByText(
                locale === 'ar'
                  ? 'مشغول · موعد آخر للشركة'
                  : 'Busy · another company appointment',
                { exact: true }
              )
              .waitFor();
            if (process.env.PHONE_CHECK_ARTIFACTS && !dark)
              await page.screenshot({
                path: join(
                  process.env.PHONE_CHECK_ARTIFACTS,
                  `${locale}-calendar-${width}.png`
                ),
              });
            continue;
          }
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
            const date = page.getByRole('button', {
              name: locale === 'ar' ? 'تاريخ الموعد' : 'Appointment date',
              exact: true,
            });
            assert.equal(await date.locator('svg').first().isVisible(), true);
            if (!dark)
              assert.notEqual(
                await date
                  .locator('svg')
                  .first()
                  .evaluate((el) => getComputedStyle(el).color),
                'rgb(255, 255, 255)',
                'Light-theme calendar icon must remain visible'
              );
            assert.ok(
              await page
                .locator('#work-location')
                .evaluate(
                  (el) => parseFloat(getComputedStyle(el).fontSize) >= 16
                ),
              'Avoid iOS field zoom'
            );
            if (locale === 'ar' && width === 390 && dark) {
              await page
                .getByLabel('موقع العمل / رابط الخريطة')
                .fill('العزيزية');
              await page
                .getByLabel('المنتجات والمتطلبات والتعليمات')
                .fill('باب');
              await page
                .getByText('أضف 7 أحرف أخرى', { exact: false })
                .waitFor();
            }
          }
        }
      }
  assert.deepEqual(errors, []);
  console.log(
    'Handoff/calendar checks passed: customer location, member default/selection, disabled conflicts and availability failure, booking/rescheduling, reports/share attribution, workshop gate and 48 bilingual layouts including short laptop windows.'
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
