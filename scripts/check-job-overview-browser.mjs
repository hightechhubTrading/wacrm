/** Actual job overview + source work dialog; synthetic transport, no customer traffic. */
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  readFile,
  realpath,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = await realpath(
  await mkdtemp(join(tmpdir(), 'wacrm-job-overview-'))
);
const en = JSON.parse(
  await readFile(join(project, 'messages/en.json'), 'utf8')
);
const ar = JSON.parse(
  await readFile(join(project, 'messages/ar.json'), 'utf8')
);
let server, browser, page;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  const stubs = {
    'can.ts': `export const useCan=()=>true;`,
    'auth.ts': `export const useAuth=()=>({accountId:'fixture-account',user:{id:'fixture-user'},accountRole:'owner'});`,
    'link.tsx': `export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`,
    'fields.tsx': `export const CustomFieldGroupFields=()=>null;`,
    'quotes.tsx': `export function QuotationsDialog({dealId,onOpenChange}){return <div role="dialog" aria-label="Fixture quotations"><p>{dealId}</p><button onClick={()=>onOpenChange(false)}>Close fixture quotes</button></div>;}`,
  };
  for (const [path, code] of Object.entries(stubs))
    await writeFile(join(root, path), code);
  await writeFile(
    join(root, 'main.tsx'),
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';
    import {DealSalesPanel} from ${JSON.stringify(join(project, 'src/components/inbox/sales-workspace.tsx'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import '@fontsource/tajawal/arabic-400.css';import '@fontsource/tajawal/arabic-500.css';
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};import ${JSON.stringify(join(project, 'src/app/design-system.css'))};import ${JSON.stringify(join(project, 'src/app/workspace.css'))};import ${JSON.stringify(join(project, 'src/app/inbox-workspace.css'))};
    const params=new URLSearchParams(location.search),locale=params.get('locale')||'en';document.documentElement.style.setProperty('--font-sans','Arial');document.documentElement.style.setProperty('--font-arabic','Tajawal');document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
    if(params.has('dark'))document.documentElement.classList.add('dark');
    const deals=['a','b'].map((id,index)=>({id:'job-'+id,contact_id:'contact',title:index?'Second synthetic job':'مشروع نافذة طويل — Window project',value:2400,currency:'QAR',status:'open',stage:{name:'Measurement'},assignee:{full_name:'Synthetic salesperson'}}));
    function App(){const [selected,setSelected]=useState('');return <NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><main className="crm-workspace crm-inbox p-4" style={{height:'auto',minHeight:'100dvh'}}><div className="crm-customer-inspector" style={{width:'100%',maxWidth:480,margin:'auto'}}><DealSalesPanel deals={deals} contactId="contact" selectedDealId={selected} onSelectDeal={setSelected}/></div></main></NextIntlClientProvider>;}createRoot(document.getElementById('root')).render(<App/>);
  `
  );
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-can', replacement: join(root, 'can.ts') },
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        {
          find: '@/components/custom-fields/custom-field-group-fields',
          replacement: join(root, 'fields.tsx'),
        },
        {
          find: '@/components/pipelines/quotations-dialog',
          replacement: join(root, 'quotes.tsx'),
        },
        { find: 'next/link', replacement: join(root, 'link.tsx') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: join(root, 'dist'), emptyOutDir: true },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0 },
  });
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    timezoneId: 'Europe/Berlin',
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const accepted = {
    id: 'accepted-quote',
    reference: 'HTH-ACCEPTED',
    revision: 2,
  };
  const quote = {
    id: 'new-quote',
    reference: 'HTH-NEW-DRAFT',
    revision: 3,
    status: 'draft',
    createdAt: '2026-10-30T09:00:00Z',
  };
  const report = {
    id: 'measurement-report',
    deal_id: 'job-a',
    reference: 42,
    kind: 'measurement',
    status: 'report_received',
    location: 'Synthetic site',
    details: 'Measurement request',
    responsible: 'Synthetic salesperson',
    due_at: '2026-10-29T21:30:00Z',
    revision: 2,
    updated_at: '2026-10-30T10:00:00Z',
    created_at: '2026-10-28T08:00:00Z',
    quotation_snapshot: null,
    events: [
      {
        id: 'report-event',
        action: 'report',
        status: 'report_received',
        note: 'Synthetic measurement result 2400 × 1600',
        attachments: [],
        created_at: '2026-10-30T10:00:00Z',
      },
    ],
  };
  const workshop = {
    ...report,
    id: 'workshop',
    kind: 'workshop',
    status: 'blocked',
    details: 'Keep this workshop snapshot',
    quotation_snapshot: {
      reference: accepted.reference,
      revision: 2,
      items: [],
    },
    events: [
      {
        id: 'blocked-event',
        action: 'blocked',
        status: 'blocked',
        note: 'Synthetic blocker: waiting for materials',
        attachments: [],
        created_at: '2026-10-30T11:00:00Z',
      },
    ],
  };
  let mode = 'success',
    delayA = false,
    requests = [];
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(origin).origin
      ? route.continue()
      : route.abort()
  );
  await page.route('**/api/quotations?**', (route) => {
    requests.push(route.request().url());
    return mode === 'quote-error'
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: [quote] });
  });
  await page.route('**/api/jobs/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (delayA && url.pathname.endsWith('job-a'))
      await new Promise((r) => setTimeout(r, 500));
    if (url.pathname.endsWith('job-b'))
      return route.fulfill({
        json: {
          work: [],
          quotations: [],
          deal: { title: 'Second synthetic job', contact: null },
        },
      });
    if (mode === 'work-error') return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        work: [workshop, report],
        quotations: mode === 'accepted-error' ? [] : [accepted],
        quotationsError: mode === 'accepted-error',
        deal: {
          title: 'Synthetic job',
          contact: { name: 'Synthetic customer', phone: '+15550000000' },
        },
      },
    });
  });
  await page.goto(origin);
  await page.getByText(en.Inbox.sales.chooseHint, { exact: true }).waitFor();
  assert.equal(requests.length, 0, 'multiple jobs require explicit selection');
  await page
    .getByLabel(en.Inbox.sales.selectedJob, { exact: true })
    .selectOption('job-a');
  await page
    .getByText(en.Inbox.sales.measurementResult, { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole('link', { name: /HTH-ACCEPTED/ }).getAttribute('href'),
    '/quotations/accepted-quote'
  );
  assert.equal(
    await page
      .getByRole('link', { name: /HTH-NEW-DRAFT/ })
      .getAttribute('href'),
    '/quotations/new-quote'
  );
  await page.getByText(en.Inbox.sales.workBlocked, { exact: true }).waitFor();
  await page.getByText(en.Inbox.sales.jobHistory, { exact: true }).click();
  const history = page.locator('details').filter({
    has: page.getByText(en.Inbox.sales.jobHistory, { exact: true }),
  });
  const texts = await history.locator('li').allTextContents();
  assert.ok(texts[0].includes('Synthetic blocker'));
  assert.ok(texts[1].includes('Synthetic measurement'));
  assert.ok(texts[2].includes('HTH-NEW-DRAFT'));
  await history
    .getByRole('button', {
      name: `HTH-42 · ${en.Jobs.kinds.measurement} · ${en.Jobs.statuses.report_received}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByText('Synthetic measurement result 2400 × 1600', { exact: true })
    .waitFor();
  assert.equal(
    await dialog
      .getByText('Synthetic blocker: waiting for materials', { exact: true })
      .count(),
    0,
    'terminal source is selected exactly'
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page
    .getByRole('button', { name: en.Inbox.sales.reviewBlocker, exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByText(/HTH-ACCEPTED · rev 2/)
    .waitFor();
  assert.equal(
    await page
      .getByRole('dialog')
      .getByText('HTH-NEW-DRAFT', { exact: true })
      .count(),
    0,
    'new quote cannot rewrite issued snapshot'
  );
  await page.keyboard.press('Escape');
  for (const failure of ['work-error', 'quote-error', 'accepted-error']) {
    mode = failure;
    await page.evaluate(() =>
      window.dispatchEvent(new Event('group-work-updated'))
    );
    await page
      .getByRole('button', { name: en.Inbox.sales.retryOverview, exact: true })
      .waitFor();
    if (failure === 'work-error')
      await page
        .getByRole('link', { name: /HTH-NEW-DRAFT/ })
        .first()
        .waitFor();
    else
      await page
        .getByText(en.Inbox.sales.measurementResult, { exact: true })
        .waitFor();
    mode = 'success';
    await page
      .getByRole('button', { name: en.Inbox.sales.retryOverview, exact: true })
      .click();
    await page
      .getByRole('button', { name: en.Inbox.sales.retryOverview, exact: true })
      .waitFor({ state: 'hidden' });
  }
  delayA = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event('group-work-updated'))
  );
  await page
    .getByLabel(en.Inbox.sales.selectedJob, { exact: true })
    .selectOption('job-b');
  await page
    .getByText(en.Inbox.sales.noAcceptedQuotation, { exact: false })
    .waitFor();
  await page.waitForTimeout(650);
  assert.equal(
    await page
      .getByText(en.Inbox.sales.measurementResult, { exact: true })
      .count(),
    0,
    'late results cannot populate another job'
  );
  delayA = false;
  for (const locale of ['en', 'ar'])
    for (const width of [360, 390, 1280]) {
      const messages = locale === 'en' ? en : ar;
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        origin + '?locale=' + locale + (width === 390 ? '&dark=1' : '')
      );
      await page
        .getByLabel(messages.Inbox.sales.selectedJob, { exact: true })
        .selectOption('job-a');
      await page
        .getByText(messages.Inbox.sales.measurementResult, { exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false,
        `${locale} ${width} overflow`
      );
      if (width === 390) {
        await page.screenshot({
          path: join(tmpdir(), `wacrm-job-${locale}.png`),
          fullPage: true,
        });
      }
    }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => (document.documentElement.style.zoom = '2'));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false,
    '200% zoom remains usable'
  );
  await page.evaluate(() => (document.documentElement.style.zoom = '1'));
  await page.setViewportSize({ width: 360, height: 800 });
  report.events[0].note = 'Reference' + 'X'.repeat(300) + ' قياس نافذة طويل';
  await page.evaluate(() =>
    window.dispatchEvent(new Event('group-work-updated'))
  );
  await page
    .getByText(report.events[0].note, { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false,
    'long report references wrap'
  );
  assert.deepEqual(errors, []);
  console.log(
    'Job overview browser passed: explicit job selection, independent failures/retry, accepted quotation, terminal source, immutable workshop snapshot, history ordering, stale switch and bilingual layouts.'
  );
} catch (error) {
  if (page)
    console.error((await page.locator('body').innerText()).slice(0, 4000));
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server?.httpServer.close(r) ?? r());
  await rm(root, { recursive: true, force: true });
}
