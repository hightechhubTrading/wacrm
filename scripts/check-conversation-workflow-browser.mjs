/** Actual status menu and customer inspector, synthetic scoped transport only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = process.cwd(),
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'hth-workflow-'))
  );
let server,
  browser,
  cases = 0;
const errors = [];
try {
  await fs.symlink(
    path.join(project, 'node_modules'),
    path.join(root, 'node_modules')
  );
  await fs.writeFile(
    path.join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await fs.writeFile(
    path.join(root, 'auth.ts'),
    'export const useAuth=()=>({accountId:"account",user:{id:"user-1"},canSendMessages:true});export const useCan=()=>true;'
  );
  await fs.writeFile(
    path.join(root, 'db.ts'),
    `const deal={id:'deal',contact_id:'contact',conversation_id:'chat',title:'Synthetic job',value:0,currency:'QAR',status:'open',stage:{name:'New Lead'},assignee:{full_name:'WRONG LEGACY OWNER'}};export function createClient(){return {from(table){let filters={};let builder=new Proxy({}, {get(_,key){if(key==='then'){const data=table==='profiles'?{full_name:filters.user_id==='user-2'?'Omar':'Aisha'}:table==='deals'?[deal]:[];window.dbReads=(window.dbReads||[]).concat([{table,filters}]);return Promise.resolve({data,error:null}).then.bind(Promise.resolve({data,error:null}));}return (...args)=>{if(key==='eq')filters[args[0]]=args[1];return builder}}});return builder;}};}`
  );
  await fs.writeFile(
    path.join(root, 'main.tsx'),
    `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {ContactSidebar} from ${JSON.stringify(path.join(project, 'src/components/inbox/contact-sidebar.tsx'))};import {ConversationStatusMenu} from ${JSON.stringify(path.join(project, 'src/components/inbox/conversation-status-menu.tsx'))};import en from ${JSON.stringify(path.join(project, 'messages/en.json'))};import ar from ${JSON.stringify(path.join(project, 'messages/ar.json'))};import ${JSON.stringify(path.join(project, 'src/app/globals.css'))};import ${JSON.stringify(path.join(project, 'src/app/inbox-workspace.css'))};const p=new URLSearchParams(location.search),locale=p.get('locale')||'en';document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.dataset.mode=p.get('mode');document.documentElement.dataset.theme='navy-gold';document.documentElement.classList.toggle('dark',p.get('mode')==='dark');function App(){const [owner,setOwner]=useState('user-1'),[state,setState]=useState({status:'open',work_status:null});return <NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><main style={{padding:16,maxWidth:480}}><div data-core-status={state.status} data-work-status={state.work_status||''}><ConversationStatusMenu status={state.status} workStatus={state.work_status} onChange={(status,work_status)=>setState({status,work_status})}/></div><button onClick={()=>setOwner('user-2')}>Assign Omar fixture</button><button onClick={()=>setOwner(null)}>Unassign fixture</button><ContactSidebar contact={{id:'contact',name:'Synthetic Customer',phone:'+97450000000',tags:[],customValues:[]}} conversation={{id:'chat',contact_id:'contact',assigned_agent_id:owner,status:state.status,work_status:state.work_status}}/></main></NextIntlClientProvider>};createRoot(document.getElementById('root')).render(<App/>);`
  );
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: path.join(root, 'auth.ts') },
        { find: '@/hooks/use-can', replacement: path.join(root, 'auth.ts') },
        {
          find: '@/lib/supabase/client',
          replacement: path.join(root, 'db.ts'),
        },
        { find: '@', replacement: path.join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: path.join(root, 'dist'), emptyOutDir: true },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0 },
  });
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  await fs.mkdir('.local/conversation-workflow', { recursive: true });
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1200]) {
        const messages = JSON.parse(
            await fs.readFile(`messages/${locale}.json`, 'utf8')
          ),
          t = messages.Inbox.messageThread,
          sales = messages.Inbox.sales;
        const p = await browser.newPage({ viewport: { width, height: 1100 } });
        p.setDefaultTimeout(10000);
        p.on('pageerror', (e) => errors.push(e.message));
        await p.route('**/api/**', async (r) => {
          assert.equal(r.request().method(), 'GET', 'Unexpected write');
          const url = new URL(r.request().url()).pathname;
          await r.fulfill({
            json: url.startsWith('/api/jobs/')
              ? { work: [], quotations: [] }
              : [],
          });
        });
        await p.goto(
          server.resolvedUrls.local[0] + `?locale=${locale}&mode=${mode}`
        );
        for (const [stage, core] of [
          ['preparing_quotation', 'open'],
          ['awaiting_customer', 'pending'],
          ['site_visit', 'open'],
          ['installation', 'open'],
          ['maintenance', 'open'],
          ['completed', 'closed'],
          ['cancelled', 'closed'],
        ]) {
          await p.getByRole('button', { name: t.status, exact: true }).click();
          await p
            .getByRole('menuitem', { name: t.workStatuses[stage], exact: true })
            .click();
          assert.equal(
            await p
              .locator('[data-core-status]')
              .getAttribute('data-core-status'),
            core
          );
          assert.equal(
            await p
              .locator('[data-work-status]')
              .getAttribute('data-work-status'),
            stage
          );
        }
        await p.getByRole('button', { name: t.status, exact: true }).click();
        await p
          .getByRole('menuitem', { name: t.statusOpen, exact: true })
          .click();
        assert.equal(
          await p
            .locator('[data-work-status]')
            .getAttribute('data-work-status'),
          ''
        );
        await p
          .getByRole('tab', {
            name: messages.Inbox.sidebar.salesTab,
            exact: true,
          })
          .click();
        await p
          .locator('.crm-sales-facts')
          .getByText('Aisha', { exact: true })
          .waitFor();
        assert.equal(
          await p.getByText('WRONG LEGACY OWNER', { exact: true }).count(),
          0
        );
        await p.getByRole('button', { name: 'Assign Omar fixture' }).click();
        await p
          .locator('.crm-sales-facts')
          .getByText('Omar', { exact: true })
          .waitFor();
        const reads = await p.evaluate(() =>
          window.dbReads.filter((r) => r.table === 'profiles')
        );
        assert.ok(
          reads.some(
            (r) =>
              r.filters.user_id === 'user-2' &&
              r.filters.account_id === 'account'
          )
        );
        await p.getByRole('button', { name: 'Unassign fixture' }).click();
        await p
          .locator('.crm-sales-facts')
          .getByText(sales.ownerNotSet, { exact: true })
          .waitFor();
        await p.getByRole('button', { name: t.status, exact: true }).click();
        await p
          .getByRole('menuitem', {
            name: t.workStatuses.preparing_quotation,
            exact: true,
          })
          .click();
        await p.getByRole('menu').waitFor({ state: 'hidden' });
        await p.screenshot({
          path: `.local/conversation-workflow/${locale}-${mode}-${width}.png`,
          fullPage: true,
        });
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          true
        );
        await p.close();
        cases++;
      }
  assert.deepEqual(errors, []);
  console.log(
    `${cases} workflow/ownership journeys passed: real status menu, lifecycle mapping, legacy reopen, assigned sales name, reassignment, unassignment and account-scoped lookup. No live writes.`
  );
} finally {
  await browser?.close();
  await new Promise((r) => server?.httpServer.close(r) ?? r());
  await fs.rm(root, { recursive: true, force: true });
}
