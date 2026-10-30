/** Production saved-view/query/search/context components with synthetic transport. */
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
const project = resolve(fileURLToPath(new URL('..', import.meta.url))),
  root = await realpath(await mkdtemp(join(tmpdir(), 'wacrm-search-')));
const en = JSON.parse(
  await readFile(join(project, 'messages/en.json'), 'utf8')
);
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  conversation = uuid(1),
  match = uuid(2),
  tag = uuid(3);
let server, browser, page;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.tsx'),
    `import {createContext,useContext} from 'react';export const Auth=createContext(null);export const useAuth=()=>useContext(Auth);`
  );
  await writeFile(
    join(root, 'main.tsx'),
    `
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {Auth} from './auth';
 import {useInboxQuery} from ${JSON.stringify(join(project, 'src/hooks/use-inbox-query.ts'))};
 import {SavedViews} from ${JSON.stringify(join(project, 'src/components/inbox/saved-views.tsx'))};
 import {MessageSearch} from ${JSON.stringify(join(project, 'src/components/inbox/message-search.tsx'))};
 import {MessageSearchContext} from ${JSON.stringify(join(project, 'src/components/inbox/message-search-context.tsx'))};
 import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
 import ${JSON.stringify(join(project, 'src/app/globals.css'))};import ${JSON.stringify(join(project, 'src/app/design-system.css'))};import ${JSON.stringify(join(project, 'src/app/inbox-workspace.css'))};
 const params=new URLSearchParams(location.search),locale=params.get('locale')||'en';document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';window.opened=[];
 function Query(){const {query,update}=useInboxQuery(true);return <section><div data-query>{JSON.stringify(query)}</div><button onClick={()=>update({view:'unread'})}>Unread fixture</button><button onClick={()=>update({view:'all'})}>All fixture</button><input aria-label="Queue search fixture" value={query.search} onChange={e=>update({search:e.target.value},'replace')}/><SavedViews query={query} onApply={q=>update(q)} canReadSales/></section>}
 function App(){const [user,setUser]=useState('user'),[target,setTarget]=useState(null);return <Auth.Provider value={{accountId:'account',user:{id:user}}}><NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Europe/Berlin"><main className="crm-workspace p-4" style={{maxWidth:720}}><button onClick={()=>setUser(user==='user'?'other':'user')}>Switch user fixture</button>{params.get('screen')==='views'?<Query/>:<><MessageSearch activeConversationId=${JSON.stringify(conversation)} onOpenMessage={async(c,m)=>{window.opened.push({c,m});setTarget(m);return true}}/>{target&&<div style={{height:400,overflowY:'auto'}}><MessageSearchContext conversationId=${JSON.stringify(conversation)} messageId={target} contactLabel="Synthetic customer" onReturn={()=>setTarget(null)} onReply={m=>{window.replied=m.id;setTarget(null)}}/></div>}</>}</main></NextIntlClientProvider></Auth.Provider>}
 createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
 `
  );
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.tsx') },
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
    timezoneId: 'Europe/Berlin',
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  let failSearch = true,
    failContext = true;
  const searches = [],
    contexts = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname === '/api/inbox/message-search') {
      const body = route.request().postDataJSON();
      if (body.action === 'context') {
        contexts.push(body);
        if (failContext)
          return route.fulfill({
            status: 503,
            json: { error: 'synthetic outage' },
          });
        return route.fulfill({
          json: {
            found: true,
            messages: [
              {
                id: uuid(4),
                conversation_id: conversation,
                sender_type: 'customer',
                content_type: 'text',
                content_text: 'Earlier context',
                status: 'read',
                created_at: '2026-10-25T08:59:00Z',
              },
              {
                id: match,
                conversation_id: conversation,
                sender_type: 'customer',
                content_type: 'text',
                content_text: 'Older window message',
                status: 'read',
                created_at: '2026-10-25T09:00:00Z',
              },
              {
                id: uuid(5),
                conversation_id: conversation,
                sender_type: 'agent',
                content_type: 'text',
                content_text: 'Later context',
                status: 'read',
                created_at: '2026-10-25T09:01:00Z',
              },
            ],
          },
        });
      }
      searches.push(body);
      if (failSearch)
        return route.fulfill({
          status: 503,
          json: { error: 'synthetic outage' },
        });
      return route.fulfill({
        json: {
          items: [
            {
              id: body.cursor ? uuid(6) : match,
              conversation_id: conversation,
              sender_type: 'customer',
              content_type: 'text',
              contact_name: 'Synthetic customer',
              contact_phone: '+15550000000',
              created_at: body.cursor ? null : '2026-10-25T09:00:00Z',
              source: body.cursor ? 'transcript' : 'message',
              excerpt: body.cursor
                ? 'A voice ⟦window⟧ transcript'
                : 'An old ⟦window⟧ message',
            },
          ],
          total: 2,
          nextCursor: body.cursor
            ? null
            : { id: match, created_at: '2026-10-25T09:00:00Z' },
        },
      });
    }
    if (url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  const query = async () =>
    JSON.parse(await page.locator('[data-query]').innerText());
  await page.goto(
    origin +
      `?screen=views&c=conversation&m=message&view=needs_reply&sort=oldest&tag=${tag}&q=outside`
  );
  assert.equal((await query()).view, 'needs_reply');
  assert.equal((await query()).sort, 'oldest');
  assert.deepEqual((await query()).tags, [tag]);
  await page
    .getByRole('button', { name: 'Unread fixture', exact: true })
    .click();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'unread');
  assert.equal(new URL(page.url()).searchParams.get('m'), 'message');
  await page.getByText(en.Inbox.savedViews.title, { exact: true }).click();
  await page
    .getByRole('button', { name: en.Inbox.savedViews.saveCurrent, exact: true })
    .click();
  await page.getByLabel(en.Inbox.savedViews.name, { exact: true }).fill('   ');
  await page
    .getByRole('button', { name: en.Inbox.savedViews.save, exact: true })
    .click();
  await page
    .getByText(en.Inbox.savedViews.nameRequired, { exact: true })
    .waitFor();
  await page
    .getByLabel(en.Inbox.savedViews.name, { exact: true })
    .fill('My follow-ups');
  await page
    .getByRole('button', { name: en.Inbox.savedViews.save, exact: true })
    .click();
  const savedId = await page
    .getByRole('combobox', { name: en.Inbox.savedViews.choose, exact: true })
    .inputValue();
  assert.match(savedId, /^[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'All fixture', exact: true }).click();
  assert.equal((await query()).view, 'all');
  await page
    .getByRole('combobox', { name: en.Inbox.savedViews.choose, exact: true })
    .selectOption(savedId);
  assert.equal((await query()).view, 'unread');
  await page.goBack();
  assert.equal((await query()).view, 'all');
  await page.reload();
  assert.equal((await query()).sort, 'oldest');
  await page.getByText(en.Inbox.savedViews.title, { exact: true }).click();
  await page
    .getByRole('combobox', { name: en.Inbox.savedViews.choose, exact: true })
    .selectOption(savedId);
  assert.equal((await query()).view, 'unread');
  await page
    .getByRole('button', { name: 'Switch user fixture', exact: true })
    .click();
  assert.equal(
    await page.locator('option').filter({ hasText: 'My follow-ups' }).count(),
    0
  );
  await page.goto(origin + '?screen=search');
  await page
    .getByRole('button', { name: en.Inbox.historySearch.title, exact: true })
    .click();
  await page
    .getByLabel(en.Inbox.historySearch.query, { exact: true })
    .fill('window');
  await page
    .getByLabel(en.Inbox.historySearch.from, { exact: true })
    .fill('2026-10-25');
  await page
    .getByLabel(en.Inbox.historySearch.to, { exact: true })
    .fill('2026-10-25');
  await page
    .getByLabel(en.Inbox.historySearch.sender, { exact: true })
    .selectOption('customer');
  await page
    .getByLabel(en.Inbox.historySearch.onlyCurrent, { exact: true })
    .check();
  await page
    .getByRole('button', { name: en.Inbox.historySearch.search, exact: true })
    .click();
  await page
    .getByText(en.Inbox.historySearch.failed, { exact: true })
    .waitFor();
  failSearch = false;
  await page
    .getByRole('button', { name: en.Recovery.retry, exact: true })
    .click();
  await page.getByRole('button', { name: /Synthetic customer/ }).waitFor();
  assert.equal(searches.at(-1).conversationId, conversation);
  assert.equal(searches.at(-1).sender, 'customer');
  assert.equal(
    Date.parse(searches.at(-1).to) - Date.parse(searches.at(-1).from),
    24 * 60 * 60 * 1000
  );
  await page
    .getByRole('button', { name: en.Inbox.historySearch.loadMore, exact: true })
    .click();
  await page
    .getByText(en.Inbox.historySearch.dateUnknown, { exact: true })
    .waitFor();
  assert.ok(searches.at(-1).cursor);
  await page
    .getByRole('button', { name: /Synthetic customer/ })
    .first()
    .click();
  await page
    .getByText(en.Inbox.historySearch.openFailed, { exact: true })
    .waitFor();
  failContext = false;
  await page
    .getByRole('button', { name: en.Recovery.retry, exact: true })
    .click();
  await page.waitForFunction(() =>
    document.activeElement?.textContent?.includes('Older window message')
  );
  assert.equal(contexts.at(-1).messageId, match);
  assert.deepEqual(await page.evaluate(() => window.opened), [
    { c: conversation, m: match },
  ]);
  await page
    .getByRole('button', {
      name: en.Inbox.historySearch.replyToMatch,
      exact: true,
    })
    .click();
  assert.equal(await page.evaluate(() => window.replied), match);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '?screen=search&locale=ar');
  await page
    .getByRole('button', { name: 'البحث في سجل الرسائل', exact: true })
    .click();
  await page.getByLabel('كلمات البحث', { exact: true }).fill('نافذة');
  await page
    .getByRole('button', { name: 'البحث في الرسائل', exact: true })
    .click();
  await page.getByRole('button', { name: /Synthetic customer/ }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  assert.deepEqual(errors, []);
  console.log(
    'Inbox search browser passed: URL restore/back, scoped saved views, search retry/paging/filters/Qatar dates, old-message context/focus/reply and Arabic phone.'
  );
} catch (error) {
  if (page)
    console.error((await page.locator('body').innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server?.httpServer.close(r) ?? r());
  await rm(root, { recursive: true, force: true });
}
