/** Production recovery/contacts UI; synthetic Supabase and browser network state. */
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  realpath,
  readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = await realpath(await mkdtemp(join(tmpdir(), 'wacrm-recovery-')));
const en = JSON.parse(
  await readFile(join(project, 'messages/en.json'), 'utf8')
);
let server, browser, page;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.ts'),
    `export const useAuth=()=>({accountId:'fixture-account',user:{id:'fixture-user'},accountRole:'owner',canEditSettings:true,defaultCurrency:'QAR'});`
  );
  await writeFile(
    join(root, 'navigation.ts'),
    `export const usePathname=()=>'/inbox'; export const useRouter=()=>({push:()=>{},replace:()=>{},prefetch:()=>{}});`
  );
  await writeFile(
    join(root, 'badges.ts'),
    `export const useTotalUnread=()=>0;export const useUnreadNotifications=()=>0;export const useAppearance=()=>({mode:'light',toggleMode:()=>{}});`
  );
  await writeFile(join(root, 'can.ts'), `export const useCan=()=>true;`);
  await writeFile(
    join(root, 'link.tsx'),
    `export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`
  );
  await writeFile(
    join(root, 'supabase.ts'),
    `
 const result=table=>{
   if(table==='contacts')return window.fixture.mode==='error'?{data:null,error:{message:'synthetic outage'}}:{data:[{id:'customer',account_id:'fixture-account',name:'Synthetic customer',phone:'+15550000000',created_at:'2026-10-30T08:00:00Z'}],count:1,error:null};
   if(table==='tags')return window.fixture.tagsError?{data:null,error:{message:'synthetic outage'}}:{data:[],error:null};
   return {data:[],error:null};
 };
 const db={channel:()=>{const c={on:(...args)=>{window.activityEvent=args.at(-1);return c;},subscribe:cb=>{window.channels=window.channels||[];window.channels.push(cb);window.latestChannel=cb;return c;}};return c;},removeChannel:()=>{window.removed=(window.removed||0)+1;},from:table=>{const b={};for(const key of ['select','eq','in','order','range','or','limit'])b[key]=()=>b;
   b.then=(resolve)=>{const snapshot=result(table);window.pendingQueries=(window.pendingQueries||0)+1;return new Promise(r=>setTimeout(()=>{window.pendingQueries--;r(snapshot)},15)).then(resolve)};
   b.single=async()=>result(table);b.maybeSingle=async()=>result(table);
   for(const key of ['insert','update','delete'])b[key]=()=>{throw new Error('Fixture blocked writes')};return b;},rpc:async()=>({data:[],error:null})};
 export const createClient=()=>db;`
  );
  await writeFile(
    join(root, 'main.tsx'),
    `
 import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';
 import Contacts from ${JSON.stringify(join(project, 'src/app/(dashboard)/contacts/page.tsx'))};
 import {Sidebar} from ${JSON.stringify(join(project, 'src/components/layout/sidebar.tsx'))};
 import {MobileNavigation} from ${JSON.stringify(join(project, 'src/components/layout/mobile-navigation.tsx'))};
 import {ConversationActivity} from ${JSON.stringify(join(project, 'src/components/inbox/conversation-activity.tsx'))};
 import {ConnectionNotice} from ${JSON.stringify(join(project, 'src/components/inbox/connection-notice.tsx'))};
 import {useKeyboardViewport} from ${JSON.stringify(join(project, 'src/hooks/use-keyboard-viewport.ts'))};
 import {useRealtime} from ${JSON.stringify(join(project, 'src/hooks/use-realtime.ts'))};
 import {RecoveryPanel} from ${JSON.stringify(join(project, 'src/components/workspace/recovery-panel.tsx'))};
 import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
 import ${JSON.stringify(join(project, 'src/app/workspace.css'))};import ${JSON.stringify(join(project, 'src/app/globals.css'))};import ${JSON.stringify(join(project, 'src/app/design-system.css'))};
 const params=new URLSearchParams(location.search);const locale=params.get('locale')||'en';const screen=params.get('screen')||'contacts';
 document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
 window.fixture={mode:params.get('mode')||'error',tagsError:false};window.retries=0;
 function Connection(){const {isConnected,lastConnectedAt,retryConnection}=useRealtime({channelName:'fixture',onReconnect:()=>{window.resyncs=(window.resyncs||0)+1}});return <ConnectionNotice connected={isConnected} lastConnectedAt={lastConnectedAt} lastSynchronizedAt={Date.parse("2026-10-29T21:30:00Z")} onRetry={()=>{window.retries++;retryConnection()}}/>;}
 function KeyboardFixture(){useKeyboardViewport();return <div className="flex h-full flex-col"><div className="min-h-0 flex-1 overflow-auto"><p>Keyboard viewport fixture</p></div><div className="crm-composer flex shrink-0 gap-2"><textarea aria-label="Keyboard reply"/><button>Send fixture</button></div><MobileNavigation expanded={false} onMore={()=>{}}/></div>;}
 function NavFixture(){const [open,setOpen]=useState(false);const close=useCallback(()=>setOpen(false),[]);return <><Sidebar open={open} onClose={close}/><div inert={open||undefined}><MobileNavigation expanded={open} onMore={()=>setOpen(true)}/><button>Outside drawer</button></div></>;}
 function ActivityFixture(){const [visible,setVisible]=useState(true);const [conversation,setConversation]=useState('fixture-chat');return <><button onClick={()=>setVisible(false)}>Leave conversation</button><button onClick={()=>setConversation('fixture-next')}>Switch conversation</button>{visible&&<ConversationActivity conversationId={conversation} assignedAgentId="other-agent" onTakeOver={async()=>{window.takeovers=(window.takeovers||0)+1}}/>}<div className="crm-composer" data-conversation-composer={conversation}><textarea aria-label="Reply"/></div></>;}
 function App(){return <NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar">
 <main className="crm-workspace p-4">{screen==='keyboard'?<KeyboardFixture/>:screen==='navigation'?<NavFixture/>:screen==='activity'?<ActivityFixture/>:screen==='contacts'?<Contacts/>:screen==='connection'?<Connection/>:<RecoveryPanel retry={()=>window.retries++}/>}</main>
 </NextIntlClientProvider>;}createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
 `
  );
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        { find: '@/hooks/use-can', replacement: join(root, 'can.ts') },
        ...[
          '@/hooks/use-total-unread',
          '@/hooks/use-unread-notifications',
          '@/hooks/use-appearance',
        ].map((find) => ({ find, replacement: join(root, 'badges.ts') })),
        {
          find: '@/lib/supabase/client',
          replacement: join(root, 'supabase.ts'),
        },
        { find: 'next/link', replacement: join(root, 'link.tsx') },
        { find: 'next/navigation', replacement: join(root, 'navigation.ts') },
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    timezoneId: 'America/Los_Angeles',
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(origin).origin
      ? route.continue()
      : route.abort()
  );
  await page.goto(origin);
  await page
    .getByRole('alert')
    .filter({ hasText: en.Contacts.page.loadFailed })
    .waitFor();
  assert.equal(
    await page
      .getByText(en.Contacts.page.noContactsYet, { exact: true })
      .count(),
    0
  );
  await page.waitForFunction(() => window.pendingQueries === 0);
  await page.evaluate(() => {
    window.fixture.mode = 'success';
  });
  await page
    .getByRole('button', { name: en.Recovery.retry, exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Synthetic customer', exact: true })
    .waitFor();
  // A failed new search must label retained rows as previous results.
  await page.evaluate(() => {
    window.fixture.mode = 'error';
  });
  await page
    .getByPlaceholder(en.Contacts.page.searchPlaceholder)
    .fill('unavailable query');
  await page
    .getByRole('alert')
    .filter({ hasText: en.Contacts.page.loadFailed })
    .waitFor();
  assert.equal(await page.getByText(/Showing earlier results/).count(), 1);
  await page
    .getByRole('button', { name: 'Synthetic customer', exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.fixture.mode = 'success';
    window.fixture.tagsError = true;
  });
  await page
    .getByRole('button', { name: en.Recovery.retry, exact: true })
    .click();
  // Refresh tag definitions separately through their own recovery card after reload.
  await page.goto(origin + '?mode=success');
  await page
    .getByRole('button', { name: 'Synthetic customer', exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.fixture.tagsError = true;
  });
  await page.reload(); // Boot resets fixture; use init override before mount for partial state.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'fixture', {
      configurable: true,
      get: () => ({ mode: 'success', tagsError: true }),
      set: () => {},
    });
  });
  await page.reload();
  await page
    .getByRole('status')
    .filter({ hasText: en.Contacts.page.tagsUnavailable })
    .waitFor();
  await page
    .getByRole('button', { name: 'Synthetic customer', exact: true })
    .waitFor();
  await page.goto(origin + '?screen=connection');
  await page.waitForFunction(() => typeof window.latestChannel === 'function');
  await page.evaluate(() => window.latestChannel('SUBSCRIBED'));
  await page.evaluate(() => {
    window.obsoleteChannel = window.latestChannel;
    window.latestChannel('CHANNEL_ERROR');
  });
  await page
    .getByText(en.Inbox.connection.disconnected, { exact: true })
    .waitFor();
  assert.ok(
    (await page.getByText(/Queue last refreshed:/).innerText()).includes(
      '10/30/26'
    ),
    'last successful sync uses the Qatar date across client timezones'
  );
  await page
    .getByRole('button', { name: en.Inbox.connection.retry, exact: true })
    .click();
  await page.waitForFunction(
    () => window.latestChannel !== window.obsoleteChannel
  );
  await page.evaluate(() => window.obsoleteChannel('SUBSCRIBED'));
  await page
    .getByText(en.Inbox.connection.disconnected, { exact: true })
    .waitFor();
  await page.evaluate(() => window.latestChannel('SUBSCRIBED'));
  await page
    .getByText(en.Inbox.connection.disconnected, { exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.resyncs), 1);
  await context.setOffline(true);
  await page.getByText(en.Inbox.connection.offline, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: en.Inbox.connection.retry, exact: true })
      .isDisabled(),
    true
  );
  await context.setOffline(false);
  await page.goto(origin + '?screen=recovery');
  await page.waitForFunction(
    () => document.activeElement?.id === 'recovery-title'
  );
  await page
    .getByRole('button', { name: en.Recovery.retry, exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.retries), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '?locale=ar');
  await page
    .getByRole('button', { name: 'Synthetic customer', exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  for (const locale of ['en', 'ar']) {
    await page.goto(origin + '?screen=navigation&locale=' + locale);
    const messages =
      locale === 'en'
        ? en
        : JSON.parse(await readFile(join(project, 'messages/ar.json'), 'utf8'));
    const nav = page.getByRole('navigation', {
      name: messages.Sidebar.mobileNavigation,
    });
    await nav.waitFor();
    assert.equal(
      await nav
        .getByRole('link', { name: messages.Sidebar.inbox, exact: true })
        .getAttribute('aria-current'),
      'page'
    );
    for (const target of await nav.locator('a,button').all()) {
      assert.ok((await target.boundingBox()).height >= 44);
    }
    await nav
      .getByRole('button', { name: messages.Sidebar.more, exact: true })
      .click();
    const sidebar = page.getByRole('complementary', {
      name: messages.Sidebar.primaryNavigation,
    });
    await sidebar.waitFor();
    assert.equal(
      await nav.locator('button').getAttribute('aria-expanded'),
      'true'
    );
    for (let tab = 0; tab < 24; tab++) {
      await page.keyboard.press('Tab');
      assert.equal(
        await sidebar.evaluate((el) => el.contains(document.activeElement)),
        true,
        'focus stays in the drawer'
      );
    }
    await page.keyboard.press('Escape');
    await sidebar.waitFor({ state: 'hidden' });
    assert.equal(
      await nav
        .locator('button')
        .evaluate((el) => el === document.activeElement),
      true,
      'Escape restores More focus'
    );
    await nav.getByRole('button').click();
    await sidebar.waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => !document.querySelector('[inert]'));
    assert.equal(
      await sidebar.isVisible(),
      true,
      'desktop rail remains available'
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await sidebar.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
  }
  const activityRequests = [];
  let peerLifetime = 45000,
    activityFail = false,
    activityDelay = false;
  await page.route('**/api/inbox/activity**', async (route) => {
    const request = route.request();
    activityRequests.push({
      method: request.method(),
      body: request.method() === 'POST' ? request.postDataJSON() : null,
    });
    const now = Date.now();
    if (activityDelay && request.method() === 'GET')
      await new Promise((resolve) => setTimeout(resolve, 500));
    if (activityFail) return route.fulfill({ status: 503, json: {} });
    await route.fulfill({
      json: {
        serverNow: new Date(now).toISOString(),
        peers: [
          {
            userId: 'other-agent',
            tabId: 'other-tab',
            name:
              request.url().includes('fixture-next') ||
              request.postData()?.includes('fixture-next')
                ? 'New conversation teammate'
                : 'Synthetic teammate',
            expiresAt: new Date(now + peerLifetime).toISOString(),
            composingUntil: new Date(now + 15000).toISOString(),
          },
        ],
      },
    });
  });
  await page.goto(origin + '?screen=activity');
  await page.getByText(/Synthetic teammate/).waitFor();
  await page
    .getByRole('button', { name: en.Inbox.activity.takeOver, exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.takeovers), 1);
  const postsBefore = activityRequests.filter(
    (r) => r.method === 'POST'
  ).length;
  await page.evaluate(() =>
    window.activityEvent({
      new: { user_id: 'other-agent', tab_id: 'other-tab' },
    })
  );
  await page.waitForTimeout(400);
  assert.ok(activityRequests.some((r) => r.method === 'GET'));
  assert.equal(
    activityRequests.filter((r) => r.method === 'POST').length,
    postsBefore,
    'realtime invalidations must not write heartbeats'
  );
  await page.getByRole('textbox', { name: 'Reply' }).fill('Synthetic reply');
  await page.waitForTimeout(200);
  assert.ok(activityRequests.some((r) => r.body?.composing === true));
  peerLifetime = 100;
  await page.evaluate(() =>
    window.activityEvent({
      new: { user_id: 'other-agent', tab_id: 'other-tab' },
    })
  );
  await page.getByText(/Synthetic teammate/).waitFor({ state: 'hidden' });
  peerLifetime = 45000;
  await page.evaluate(() =>
    window.activityEvent({
      new: { user_id: 'other-agent', tab_id: 'other-tab' },
    })
  );
  await page.getByText(/Synthetic teammate/).waitFor();
  activityFail = true;
  await page.evaluate(() =>
    window.activityEvent({
      new: { user_id: 'other-agent', tab_id: 'other-tab' },
    })
  );
  await page
    .getByText(en.Inbox.activity.unavailable, { exact: true })
    .waitFor();
  activityFail = false;
  await page.evaluate(() =>
    window.activityEvent({
      new: { user_id: 'other-agent', tab_id: 'other-tab' },
    })
  );
  await page.getByText(/Synthetic teammate/).waitFor();
  await page.evaluate(() => {
    window.fixtureHidden = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (window.fixtureHidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByText(/Synthetic teammate/).waitFor({ state: 'hidden' });
  await page.waitForTimeout(100);
  const hiddenRequests = activityRequests.length;
  await page.clock.install();
  await page.clock.fastForward(60000);
  await page.waitForTimeout(100);
  assert.equal(
    activityRequests.length,
    hiddenRequests,
    'hidden conversation does not heartbeat'
  );
  await page.evaluate(() => {
    window.fixtureHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByText(/Synthetic teammate/).waitFor();
  activityDelay = true;
  await page.evaluate(() =>
    window.activityEvent({
      new: { user_id: 'other-agent', tab_id: 'other-tab' },
    })
  );
  await page.waitForTimeout(200);
  await page
    .getByRole('button', { name: 'Switch conversation', exact: true })
    .click();
  await page.getByText('New conversation teammate', { exact: false }).waitFor();
  await page.waitForTimeout(600);
  assert.equal(
    await page.getByText(/Synthetic teammate/).count(),
    0,
    'stale activity cannot populate the next chat'
  );
  activityDelay = false;
  await page
    .getByRole('button', { name: 'Leave conversation', exact: true })
    .click();
  await page.waitForTimeout(200);
  const leave = activityRequests.findLast((r) => r.body?.leave === true);
  assert.ok(leave, 'leaving a conversation releases activity');
  assert.ok(
    leave.body.sequence >
      activityRequests.find((r) => r.body?.leave === false).body.sequence
  );
  await page.goto(origin + '?screen=keyboard');
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    window.fixtureViewport = { height: innerHeight, scale: 1 };
    Object.defineProperty(viewport, 'height', {
      configurable: true,
      get: () => window.fixtureViewport.height,
    });
    Object.defineProperty(viewport, 'scale', {
      configurable: true,
      get: () => window.fixtureViewport.scale,
    });
  });
  await page
    .getByRole('textbox', { name: 'Keyboard reply', exact: true })
    .focus();
  await page.evaluate(() => {
    window.fixtureViewport.height = 460;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(
    () =>
      document.documentElement.style.getPropertyValue(
        '--crm-viewport-height'
      ) === '460px'
  );
  const sendBounds = await page
    .getByRole('button', { name: 'Send fixture', exact: true })
    .boundingBox();
  assert.ok(
    sendBounds.y + sendBounds.height <= 460,
    'composer action stays inside the visible keyboard viewport'
  );
  assert.equal(
    await page.getByRole('navigation').isVisible(),
    false,
    'phone navigation yields space to the keyboard'
  );
  await page.evaluate(() => {
    window.fixtureViewport.scale = 2;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(
    () =>
      !document.documentElement.style.getPropertyValue('--crm-viewport-height')
  );
  await page.getByRole('button', { name: 'Send fixture', exact: true }).focus();
  await page.getByRole('navigation').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Recovery browser checks passed: initial failure, retry, stale rows, partial tags, offline/reconnect, recovery focus, Arabic phone, phone navigation in both languages, activity expiry/visibility/switch/errors, explicit takeover and keyboard viewport/zoom.'
  );
} catch (error) {
  if (page)
    console.error((await page.locator('body').innerText()).slice(0, 5000));
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server?.httpServer.close(r) ?? r());
  await rm(root, { recursive: true, force: true });
}
