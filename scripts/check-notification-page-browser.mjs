/** Full notification page, real intl/components, synthetic transport only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
const project = process.cwd(),
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'wacrm-notification-page-'))
  );
let server, browser;
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
    `export const useAuth=()=>({accountId:'account',user:{id:'user'},accountRole:'owner'});`
  );
  await fs.writeFile(
    path.join(root, 'nav.ts'),
    `export const useRouter=()=>({push:href=>window.pushed=href});`
  );
  await fs.writeFile(
    path.join(root, 'client.ts'),
    `
 const rows=[{id:'notice',account_id:'account',user_id:'user',type:'ai_handoff',title:'Synthetic handoff',body:'Synthetic source summary',created_at:new Date().toISOString(),priority:'high',category:'attention',copy_key:'ai_handoff'}];
 const channels=new Map();
 const client={from:table=>{let head=false;const q={select:(_columns,options)=>{head=!!options?.head;return q;},then:(yes,no)=>Promise.resolve({data:table==='notifications'?rows:[],count:1,error:null}).then(yes,no),maybeSingle:async()=>({data:table==='notification_preferences'?{push_categories:['attention']}:null,error:null})};for(const name of ['eq','order','limit','is','lt','in','or','update'])q[name]=()=>q;return q;},channel:name=>{if(channels.has(name))return channels.get(name);let subscribed=false;const c={on:()=>{if(subscribed)throw new Error('cannot add postgres_changes callbacks after subscribe');return c;},subscribe:fn=>{subscribed=true;queueMicrotask(()=>fn('SUBSCRIBED'));return c;}};channels.set(name,c);return c;},removeChannel:c=>{for(const [name,channel]of channels)if(channel===c)channels.delete(name);},rpc:async()=>({data:null,error:null})};export const createClient=()=>client;
 `
  );
  await fs.writeFile(
    path.join(root, 'main.tsx'),
    `
 import {useUnreadNotifications} from '@/hooks/use-unread-notifications';
 import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import Page from ${JSON.stringify(path.join(project, 'src/app/(dashboard)/notifications/page.tsx'))};import en from ${JSON.stringify(path.join(project, 'messages/en.json'))};import ar from ${JSON.stringify(path.join(project, 'messages/ar.json'))};
 const locale=new URLSearchParams(location.search).get('locale')||'ar';
 window.fetch=async url=>({ok:true,json:async()=>url.includes('/health')?{pending:0,failed:0,workerHealthy:true,pushPending:0,pushConfigured:false,lastSuccessAt:new Date().toISOString(),policy:{escalation_enabled:false,escalation_minutes:15}}:{foreground:true,sound:false,supervise:false,quiet:null}});
 function BadgeProbe(){const count=useUnreadNotifications();return <span data-testid="badge">{count}</span>;}
 createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en}><React.StrictMode><BadgeProbe/><BadgeProbe/><Page/></React.StrictMode></NextIntlClientProvider>);
 `
  );
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: path.join(root, 'auth.ts') },
        {
          find: '@/lib/supabase/client',
          replacement: path.join(root, 'client.ts'),
        },
        { find: 'next/navigation', replacement: path.join(root, 'nav.ts') },
        { find: '@', replacement: path.join(project, 'src') },
      ],
    },
    build: { outDir: path.join(root, 'dist'), emptyOutDir: true },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0 },
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const locale of ['ar', 'en']) {
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/?locale=${locale}`
    );
    await page.waitForTimeout(600);
    console.log(locale, await page.locator('body').innerText(), errors);
    assert.equal(errors.length, 0);
    assert.equal(await page.locator('li').count(), 1);
  }
  console.log(
    'PASS full notification page with real EN/AR translation providers.'
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await fs.rm(root, { recursive: true, force: true });
}
