/** Production Today components with synthetic data and an isolated mocked transport. */
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = await mkdtemp(join(tmpdir(), 'wacrm-today-'));
let server, browser;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.ts'),
    `
    import {useState,useEffect} from 'react';
    export function useAuth() {
      const [auth,setAuth]=useState({user:{id:'synthetic-user'},accountId:'synthetic-account',canSendMessages:true,accountRole:'agent',profileLoading:false});
      useEffect(()=>{window.changeAuth=setAuth; return ()=>{delete window.changeAuth};},[]);
      return auth;
    }
  `
  );
  await writeFile(
    join(root, 'presence.ts'),
    'export const usePresence=()=>({getPresence:()=>"online"});'
  );
  await writeFile(
    join(root, 'client.ts'),
    `
    export function createClient(){
      function query(table,args){
        const calls=[];
        const chain={then: (yes,no)=>fetch('/__fixture/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,args,calls})}).then(r=>r.json()).then(yes,no)};
        for(const name of ['select','eq','in','or','lt','order','limit']) chain[name]=(...args)=>{calls.push([name,args]);return chain};
        return chain;
      }
      return {from:table=>query(table),rpc:(table,args)=>query(table,args)};
    }
  `
  );
  await writeFile(
    join(root, 'main.tsx'),
    `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {NextIntlClientProvider} from 'next-intl';import {Toaster} from 'sonner';
    import {Agenda} from ${JSON.stringify(join(project, 'src/components/dashboard/agenda.tsx'))};
    import widgets from ${JSON.stringify(join(project, 'src/components/dashboard/workday-widget.module.css'))};
    import surface from ${JSON.stringify(join(project, 'src/components/dashboard/dashboard-design.module.css'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};
    import ${JSON.stringify(join(project, 'src/app/workspace.css'))};
    import ${JSON.stringify(join(project, 'src/app/design-system.css'))};
    const params=new URLSearchParams(location.search),locale=params.get('locale')||'en';
    document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.lang=locale;
    document.documentElement.dataset.mode=params.has('dark')?'dark':'light';document.documentElement.dataset.theme='violet';
    document.documentElement.style.setProperty('--font-sans','Arial');document.documentElement.style.setProperty('--font-arabic','Arial');
    if(params.has('dark'))document.documentElement.classList.add('dark');
    createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><main data-mode={params.has('dark')?'dark':'light'} className={'crm-workspace '+surface.surface+' '+widgets.dashboard} style={{padding:16}}><Agenda/></main><Toaster/></NextIntlClientProvider>);
  `
  );
  server = await createServer({
    cacheDir: join(root, '.vite-cache'),
    configFile: false,
    define: { 'process.env': '{}' },
    root,
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        {
          find: '@/hooks/use-presence',
          replacement: join(root, 'presence.ts'),
        },
        { find: '@/lib/supabase/client', replacement: join(root, 'client.ts') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, project] } },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let queries = [],
    mode = 'populated',
    patches = [],
    failPatch = false;
  const day = new Date();
  day.setHours(9, 0, 0, 0);
  const due = new Date();
  due.setDate(due.getDate() - 1);
  const work = (id, status, kind = 'measurement') => ({
    id,
    deal_id: 'job-1',
    reference: 42,
    kind,
    status,
    due_at: due.toISOString(),
    responsible: 'Example colleague',
    deal: {
      title:
        status === 'blocked'
          ? 'Blocked synthetic job'
          : 'Waiting synthetic job',
    },
  });
  await page.route('**/__fixture/query', async (route) => {
    const q = route.request().postDataJSON();
    queries.push(q);
    if (
      mode === 'empty' ||
      q.args?.p_account === 'new-account' ||
      q.calls.some(
        ([name, args]) =>
          name === 'eq' && args[0] === 'account_id' && args[1] === 'new-account'
      )
    )
      return route.fulfill({
        json: {
          data:
            q.table === 'sales_today_replies' ? { items: [], count: 0 } : [],
          count: 0,
          error: null,
        },
      });
    if (mode === 'unavailable' && q.table === 'sales_today_replies')
      return route.fulfill({ json: { data: null, error: { code: '42883' } } });
    if (q.table === 'sales_today_replies')
      return route.fulfill({
        json: {
          data: {
            items: [
              {
                id: 'chat-1',
                contact: { name: 'Synthetic customer', phone: '+15550000000' },
                last_message_text: 'A customer request needing a reply',
                last_message_at: day.toISOString(),
              },
            ],
            count: 12,
          },
          error: null,
        },
      });
    if (q.table === 'ai_followups')
      return route.fulfill({
        json: {
          data: [
            {
              id: 'task-1',
              kind: 'inspection',
              status: 'open',
              owner_id: null,
              due_at: due.toISOString(),
              conversation_id: 'chat-2',
              conversation: {
                contact: { name: 'Follow-up customer', phone: '+15550000001' },
              },
            },
          ],
          count: 1,
          error: null,
        },
      });
    if (q.table === 'profiles')
      return route.fulfill({ json: { data: [], error: null } });
    const blocked = q.calls.some(
      ([name, args]) =>
        name === 'eq' && args[0] === 'status' && args[1] === 'blocked'
    );
    return route.fulfill({
      json: {
        data: [
          work(
            blocked ? 'blocked-1' : 'waiting-1',
            blocked ? 'blocked' : 'waiting'
          ),
        ],
        count: 1,
        error: null,
      },
    });
  });
  await page.route('**/api/jobs/job-1', (route) =>
    route.fulfill({
      json: {
        deal: { title: 'Synthetic job', contact: null },
        quotations: [],
        work: [
          {
            ...work('waiting-1', 'waiting'),
            location: 'Synthetic site',
            details: 'Measure the entrance',
            revision: 1,
            updated_at: day.toISOString(),
            quotation_snapshot: null,
            events: [],
          },
          {
            ...work('blocked-1', 'blocked', 'workshop'),
            location: 'Synthetic site',
            details: 'Measure the entrance',
            revision: 1,
            updated_at: day.toISOString(),
            quotation_snapshot: null,
            events: [],
          },
        ],
      },
    })
  );
  await page.route('**/api/ai/followups/chat-2', async (route) => {
    patches.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 100));
    return route.fulfill({
      status: failPatch ? 503 : 200,
      json: failPatch ? { error: 'Synthetic failure' } : { ok: true },
    });
  });
  const open = async (query = '') => {
    await page.goto(`${origin}?${query}`);
    await page
      .getByRole('heading', {
        name: query.includes('locale=ar') ? 'اليوم' : 'Today',
        exact: true,
      })
      .waitFor();
  };
  const replies = () => page.locator('.crm-today-replies');
  await open();
  await replies().getByText('Synthetic customer', { exact: true }).waitFor();
  assert.equal(
    await replies()
      .getByRole('link', { name: /Synthetic customer/ })
      .getAttribute('href'),
    '/inbox?c=chat-1'
  );
  assert.equal(
    await page
      .locator('.crm-today-followups .crm-agenda-row')
      .getAttribute('href'),
    '/inbox?c=chat-2&followup=task-1'
  );
  await replies().getByText('Showing 1 of 12.', { exact: false }).waitFor();
  assert.ok(
    queries.some(
      (q) =>
        q.table === 'ai_followups' && q.calls.some(([name]) => name === 'lt')
    ),
    'Follow-up cutoff must be queried'
  );
  await page.getByRole('button', { name: /Blocked synthetic job/ }).click();
  const sheet = page.locator('.crm-job-sheet');
  await sheet.waitFor();
  await sheet.locator('.crm-job-card').waitFor();
  assert.equal(
    await sheet.locator('.crm-job-card').count(),
    1,
    'Direct job entry must show the selected request'
  );
  await sheet.getByText('Blocked', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  failPatch = true;
  await page
    .getByRole('button', { name: 'Take ownership', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Take ownership', exact: true })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('.crm-agenda-task-actions button')?.disabled
  );
  assert.equal(patches.length, 1);
  failPatch = false;
  const before = queries.length;
  await page
    .getByRole('button', { name: 'Take ownership', exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('.crm-agenda-task-actions button')?.disabled
  );
  assert.equal(patches.at(-1).status, 'acknowledged');
  assert.ok(queries.length > before, 'Taking a task should refresh Today');
  const beforeEvent = queries.length;
  await page.evaluate(() =>
    window.dispatchEvent(new Event('group-work-updated'))
  );
  await page.waitForFunction(
    (previous) =>
      window.performance
        .getEntriesByType('resource')
        .filter((x) => x.name.includes('/__fixture/query')).length > previous,
    beforeEvent
  );

  mode = 'unavailable';
  await open();
  await replies()
    .getByText('This information is currently unavailable.', { exact: false })
    .waitFor();
  assert.equal(
    await replies()
      .getByText('No customer replies pending', { exact: false })
      .count(),
    0
  );
  await page.getByText('Waiting synthetic job', { exact: true }).waitFor();
  mode = 'empty';
  await open();
  await replies()
    .getByText('No customer replies pending', { exact: false })
    .waitFor();
  mode = 'populated';
  await open();
  await replies().getByText('Synthetic customer', { exact: true }).waitFor();
  await page.evaluate(() =>
    window.changeAuth({
      user: { id: 'new-user' },
      accountId: 'new-account',
      canSendMessages: true,
      accountRole: 'agent',
      profileLoading: false,
    })
  );
  await replies()
    .getByText('No customer replies pending', { exact: false })
    .waitFor();
  assert.equal(
    await page.getByText('Synthetic customer', { exact: true }).count(),
    0,
    'Account changes must clear previous customer rows'
  );
  await page.evaluate(() =>
    window.changeAuth({
      user: { id: 'viewer' },
      accountId: 'new-account',
      canSendMessages: false,
      accountRole: 'viewer',
      profileLoading: false,
    })
  );
  await page.locator('.crm-sales-today').waitFor({ state: 'hidden' });

  for (const locale of ['en', 'ar'])
    for (const width of [360, 390, 1280])
      for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 844 });
        await open(`locale=${locale}${dark ? '&dark' : ''}`);
        await replies()
          .getByText('Synthetic customer', { exact: true })
          .waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          `${locale}/${width}/${dark}: overflow`
        );
        if (process.env.TODAY_CHECK_ARTIFACTS && width === 390 && !dark) {
          await mkdir(process.env.TODAY_CHECK_ARTIFACTS, { recursive: true });
          await page.screenshot({
            path: join(process.env.TODAY_CHECK_ARTIFACTS, `${locale}.png`),
            fullPage: true,
          });
        }
      }
  assert.deepEqual(errors, []);
  console.log(
    'Sales Today browser checks passed: direct chat/follow-up/job entry, selected request, taking/retrying tasks, event refresh, unavailable/empty states, auth changes and 12 bilingual layouts.'
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
