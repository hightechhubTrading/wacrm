/** Production React components with a synthetic transport; no account writes. */
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
const root = await realpath(
  await mkdtemp(join(tmpdir(), 'wacrm-performance-'))
);
let server, browser;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.ts'),
    `export const useAuth=()=>({accountId:'fixture-account',user:{id:'fixture-user'},canSendMessages:true,accountRole:'owner',profileLoading:false});`
  );
  await writeFile(
    join(root, 'link.tsx'),
    `export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}`
  );
  await writeFile(
    join(root, 'client.ts'),
    `
    const listeners=new Set();
    const client={
      auth:{getSession:()=>new Promise(resolve=>{window.resolveFixtureSession=()=>resolve({data:{session:{user:{id:'auth-a'}}},error:null});}),
      onAuthStateChange(callback){listeners.add(callback);window.fixtureAuth=id=>{window.fixtureAuthUser=id;for(const fn of listeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null)};queueMicrotask(()=>window.fixtureAuth('auth-a'));return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};}},
      from(){const chain={then(yes,no){return Promise.resolve({data:[],error:null}).then(yes,no)}};
       for(const method of ['select','order','eq','in','abortSignal'])chain[method]=()=>chain;
       return chain;},
      rpc(name,args){const run=signal=>fetch(name==='account_profile'?'/__fixture/account-profile':name==='pipeline_list'?'/__fixture/pipeline':'/__fixture/inbox',{method:'POST',headers:{'Content-Type':'application/json','x-fixture-user':window.fixtureAuthUser||''},body:JSON.stringify(args),signal}).then(r=>r.json());return {abortSignal:run,then(yes,no){return run().then(yes,no)}}},
      channel(){const channel={
       on(_event,_filter,fn){window.callEvent=fn;return channel},
       subscribe(fn){window.callStatus=fn;fn('SUBSCRIBED');return channel}
      };return channel},removeChannel(){}};
    export const createClient=()=>client;

  `
  );
  await writeFile(
    join(root, 'navigation.ts'),
    `export const useSearchParams=()=>new URLSearchParams(location.search);`
  );
  await writeFile(
    join(root, 'main.tsx'),
    `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {NextIntlClientProvider} from 'next-intl';
    import {Toaster} from 'sonner';
    import {sharedMessages,routeMessages} from ${JSON.stringify(join(project, 'src/i18n/message-scopes.ts'))};
    import {CallingProvider,useCalling} from ${JSON.stringify(join(project, 'src/components/calling/calling-provider.tsx'))};
    import {QuotationList} from ${JSON.stringify(join(project, 'src/components/quotations/quotation-list.tsx'))};
    import {QuotationsDialog} from ${JSON.stringify(join(project, 'src/components/pipelines/quotations-dialog.tsx'))};
    import {useRealtime} from ${JSON.stringify(join(project, 'src/hooks/use-realtime.ts'))};
    import {AuthProvider as ActualAuthProvider,useAuth as useActualAuth} from ${JSON.stringify(join(project, 'src/hooks/use-auth.tsx'))};
    import {PipelineExplorer} from ${JSON.stringify(join(project, 'src/components/pipelines/pipeline-explorer.tsx'))};
    import {ConversationList} from ${JSON.stringify(join(project, 'src/components/inbox/conversation-list.tsx'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))};
    import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};
    import ${JSON.stringify(join(project, 'src/app/workspace.css'))};
    import ${JSON.stringify(join(project, 'src/app/design-system.css'))};
    const params=new URLSearchParams(location.search),locale=params.get('locale')||'en';
    document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
    function Probe(){const c=useCalling();return <div><span data-enabled>{String(c.enabled)}</span><button onClick={()=>c.refreshSettings()}>Refresh settings</button></div>}
    function RealtimeFixture(){const [count,setCount]=React.useState(0);const {isConnected}=useRealtime({channelName:'fixture',onReconnect:()=>setCount(value=>value+1)});return <div data-reconnects={count} data-connected={String(isConnected)}>Reconnect probe</div>}
    function InboxFixture(){const [rows,setRows]=React.useState([]),[selected,select]=React.useState(null);return <div style={{height:800,width:360,display:'flex'}}><ConversationList conversations={rows} onConversationsLoaded={setRows} onSelect={row=>select(row.id)} activeConversationId={selected}/></div>}
    function PipelineFixture(){
      const [rows,setRows]=React.useState([]),[revision,setRevision]=React.useState(0);
      const stages=[{id:'stage-a',name:'Stage A',position:0,color:'#555'},{id:'stage-b',name:'Stage B',position:1,color:'#999'}];
      return <PipelineExplorer pipelineId="fixture-pipeline" stages={stages} deals={rows} onDealsLoaded={setRows} revision={revision} onRefresh={async()=>setRevision(v=>v+1)} onDealAssigned={()=>setRevision(v=>v+1)} onDealMoved={async(id,stage)=>{await fetch('/__fixture/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,stage})});setRevision(v=>v+1)}} onAddDeal={()=>{}} onEditDeal={deal=>{window.editedDeal=deal.id}} onOpenQuotations={()=>{}}/>;
    }
    function AuthProbe(){const auth=useActualAuth();return <div data-auth-user={auth.user?.id||''} data-profile={auth.profile?.full_name||''} data-profile-loading={String(auth.profileLoading)} data-account={auth.accountId||''}>Auth probe</div>}
    function AuthFixture(){return <ActualAuthProvider><AuthProbe/></ActualAuthProvider>}
    const screen=params.get('screen');
    const catalog=locale==='ar'?ar:en;
    const route=screen==='quotes'?'quotations':(screen==='deal'||screen==='pipeline')?'pipelines':screen==='inbox'?'inbox':null;
    createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={sharedMessages(catalog)} timeZone="Asia/Qatar">
      <NextIntlClientProvider locale={locale} timeZone="Asia/Qatar" messages={route ? routeMessages(catalog,route):sharedMessages(catalog)}><main className="crm-workspace p-4">{screen==='auth'?<AuthFixture/>:screen==='pipeline'?<PipelineFixture/>:screen==='realtime'?<RealtimeFixture/>:screen==='inbox'?<InboxFixture/>:screen==='quotes'?<QuotationList/>:screen==='deal'?<QuotationsDialog open onOpenChange={()=>{}} dealId="deal-1" contactId="contact-1"/>:<CallingProvider><Probe/></CallingProvider>}</main><Toaster/></NextIntlClientProvider>
    </NextIntlClientProvider>);
  `
  );
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    define: { 'process.env': '{}' },
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        { find: '@/lib/supabase/client', replacement: join(root, 'client.ts') },
        { find: 'next/link', replacement: join(root, 'link.tsx') },
        { find: 'next/navigation', replacement: join(root, 'navigation.ts') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: join(root, 'dist'), emptyOutDir: true },
    preview: { host: '127.0.0.1', port: 0 },
  };
  await build(config);
  server = await preview(config);
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  let enabled = true,
    calls = [],
    reads = 0;
  await page.route('**/api/whatsapp/calls**', (route) => {
    assert.equal(route.request().method(), 'GET');
    if (route.request().url().endsWith('/settings'))
      return route.fulfill({ json: { enabled } });
    reads++;
    return route.fulfill({ json: { calls } });
  });
  await page.clock.install();
  await page.goto(origin);
  await page.locator('[data-enabled]').filter({ hasText: 'true' }).waitFor();
  // The global listener is still present while the document is hidden.
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
  );
  calls = [
    {
      id: 'incoming',
      direction: 'inbound',
      state: 'ringing',
      created_at: new Date().toISOString(),
      agent_user_id: null,
      customer_name: 'Synthetic caller',
    },
  ];
  await page.evaluate(() => window.callEvent({}));
  await page.getByText('Synthetic caller').waitFor();
  await page.getByRole('button', { name: 'Answer', exact: true }).waitFor();
  calls = [];
  await page.evaluate(() => window.callEvent({}));
  await page.getByText('Synthetic caller').waitFor({ state: 'hidden' });
  enabled = false;
  await page.getByRole('button', { name: 'Refresh settings' }).click();
  await page.locator('[data-enabled]').filter({ hasText: 'false' }).waitFor();
  const before = reads;
  await page.clock.runFor(12_000);
  assert.equal(reads, before);
  enabled = true;
  await page.getByRole('button', { name: 'Refresh settings' }).click();
  await page.locator('[data-enabled]').filter({ hasText: 'true' }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-enabled]').textContent === 'true'
  );
  await page.clock.runFor(1);

  await page.goto(origin + '?screen=realtime');
  await page.locator('[data-connected="true"]').waitFor();
  assert.equal(
    await page.locator('[data-reconnects]').getAttribute('data-reconnects'),
    '0'
  );
  await page.evaluate(() => {
    window.callStatus('CHANNEL_ERROR');
    window.callStatus('SUBSCRIBED');
    window.callStatus('SUBSCRIBED');
  });
  await page.locator('[data-reconnects="1"]').waitFor();
  const requests = [];
  let fail = false;
  await page.route('**/api/quotation-product-codes', (route) =>
    route.fulfill({ json: [{ code: 'PIV', label: 'Pivot', is_active: true }] })
  );
  await page.route('**/api/quotations?**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(Object.fromEntries(query));
    if (fail)
      return route.fulfill({ status: 503, json: { error: 'fixture failure' } });
    const pageNumber = Number(query.get('page') || 1),
      size = Number(query.get('pageSize') || 25),
      search = query.get('search') || '';
    const rows = Array.from({ length: search ? 1 : size }, (_, i) => ({
      id: search
        ? 'match-outside-first-page'
        : `quote-${(pageNumber - 1) * size + i + 1}`,
      reference: search
        ? 'SEARCH-MATCH'
        : `REF-${(pageNumber - 1) * size + i + 1}`,
      status: 'draft',
      clientName: 'Synthetic client',
      clientCompany: null,
      projectName: null,
      total: 100,
      currency: 'QAR',
      validUntil: null,
    }));
    return route.fulfill({
      json: rows,
      headers: { 'X-Total-Count': search ? '1' : '1500' },
    });
  });
  await page.goto(origin + '?screen=quotes');
  await page.getByRole('link', { name: 'REF-1', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 25);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('link', { name: 'REF-26', exact: true }).waitFor();
  await page.getByRole('textbox').fill('outside');
  await page.clock.runFor(300);
  await page.getByRole('link', { name: 'SEARCH-MATCH' }).waitFor();
  assert.equal(requests.at(-1).page, '1');
  assert.equal(requests.at(-1).search, 'outside');
  fail = true;
  await page.getByRole('textbox').fill('failure');
  await page.clock.runFor(300);
  await page.getByRole('button', { name: 'Try again' }).waitFor();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('link', { name: 'SEARCH-MATCH' }).waitFor();
  await page.goto(origin + '?screen=deal');
  await page.getByRole('link', { name: /REF-1 Draft/ }).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('link', { name: /REF-26 Draft/ }).waitFor();
  assert.equal(requests.at(-1).dealId, 'deal-1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '?screen=quotes&locale=ar');
  await page.getByRole('link', { name: 'REF-1', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  await page.getByRole('link', { name: 'REF-26', exact: true }).waitFor();
  const inboxRequests = [];
  await page.route('**/__fixture/inbox', (route) => {
    const args = route.request().postDataJSON();
    inboxRequests.push(args);
    const offset = args.p_cursor?.kt ?? 0;
    const narrow = args.p_search || args.p_view === 'needs_reply';
    const rows = Array.from({ length: narrow ? 1 : 50 }, (_, index) => ({
      id: `chat-${narrow ? 1500 : offset + index + 1}`,
      status: 'open',
      unread_count: 0,
      created_at: '2026-10-27',
      updated_at: '2026-10-27',
      last_message_at: '2026-10-27',
      last_message_text: 'Fixture message',
      contact: {
        id: 'contact',
        name: narrow ? 'Outside first page' : `Customer ${offset + index + 1}`,
        phone: '+15550000000',
      },
    }));
    return route.fulfill({
      json: {
        data: {
          items: args.p_metadata_only ? [] : rows,
          total: narrow ? 1 : 1500,
          counts: {
            all: narrow ? 1 : 1500,
            needs_reply: 1,
            unread: 750,
            mine: 1500,
          },
          companies: ['Example'],
          nextCursor: narrow
            ? null
            : { kt: offset + 50, id: 'last', k1: 0, k2: 0 },
        },
        error: null,
      },
    });
  });
  await page.goto(origin + '?screen=inbox');
  await page.getByRole('textbox').waitFor();
  await page.clock.runFor(1000);
  await page
    .getByRole('button', { name: 'Load more conversations' })
    .waitFor({ timeout: 5000 })
    .catch(async (error) => {
      console.error(
        JSON.stringify({
          inboxRequests,
          body: await page.locator('body').innerText(),
        })
      );
      throw error;
    });
  assert.equal(inboxRequests.filter((args) => !args.p_metadata_only).length, 1);
  assert.equal(inboxRequests[0].p_limit, 50);
  await page.getByRole('button', { name: 'Load more conversations' }).click();
  await page.clock.runFor(300);
  await page.waitForFunction(() => !document.querySelector('button[disabled]'));
  assert.equal(inboxRequests.filter((args) => !args.p_metadata_only).length, 2);
  assert.equal(
    inboxRequests.filter((args) => !args.p_metadata_only)[1].p_cursor.kt,
    50
  );
  await page.getByRole('textbox').fill('Outside');
  await page.clock.runFor(300);
  await page.getByText('Outside first page', { exact: true }).waitFor();
  assert.equal(inboxRequests.at(-1).p_search, 'Outside');
  assert.equal(inboxRequests.at(-1).p_cursor, null);
  assert.equal(
    await page.getByRole('button', { name: 'Load more conversations' }).count(),
    0
  );
  const pipelineRequests = [],
    moved = new Map();
  await page.route('**/__fixture/move', (route) => {
    const { id, stage } = route.request().postDataJSON();
    moved.set(id, stage);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/__fixture/pipeline', (route) => {
    const args = route.request().postDataJSON();
    pipelineRequests.push(args);
    const all = Array.from({ length: 1500 }, (_, index) => ({
      id: `deal-${index + 1}`,
      title: `Deal ${index + 1}`,
      stage_id:
        moved.get(`deal-${index + 1}`) || (index % 2 ? 'stage-b' : 'stage-a'),
      status: 'open',
      assigned_to: null,
      created_at: '2026-10-27',
      updated_at: '2026-10-27',
      contact: {
        id: `customer-${index}`,
        name: `Customer ${index + 1}`,
        phone: '+15550000000',
        tags:
          index % 2
            ? []
            : [{ id: 'tag-1', name: 'Special family', color: '#555' }],
      },
    }));
    const candidates = all.filter(
      (row) =>
        !args.p_filters.query ||
        row.title.toLowerCase().includes(args.p_filters.query.toLowerCase())
    );
    const filtered = candidates.filter(
      (row) =>
        !args.p_filters.tag ||
        row.contact.tags.some((t) => t.id === args.p_filters.tag)
    );
    const stageCounts = Object.fromEntries(
      ['stage-a', 'stage-b'].map((id) => [
        id,
        filtered.filter((row) => row.stage_id === id).length,
      ])
    );
    const size =
      args.p_view === 'list' ? 25 : args.p_view === 'export' ? 100 : 6;
    const items =
      args.p_view === 'board'
        ? ['stage-a', 'stage-b'].flatMap((id) =>
            filtered
              .filter((row) => row.stage_id === id)
              .slice(
                (args.p_stage_pages[id] || 0) * 6,
                ((args.p_stage_pages[id] || 0) + 1) * 6
              )
          )
        : filtered.slice(args.p_page * size, (args.p_page + 1) * size);
    const tagGroups = [
      {
        id: 'tag-1',
        tag: { id: 'tag-1', name: 'Special family', color: '#555' },
        total: candidates.filter((row) => row.contact.tags.length).length,
        open: 750,
        overdue: 0,
      },
      {
        id: '__untagged__',
        tag: null,
        total: candidates.filter((row) => !row.contact.tags.length).length,
        open: 750,
        overdue: 0,
      },
    ];
    return route.fulfill({
      json: {
        data: {
          items,
          total: filtered.length,
          pipelineTotal: 1500,
          page: args.p_page,
          stageCounts,
          stagePages: args.p_stage_pages,
          summary: {
            open: filtered.length,
            won: 0,
            overdue: 0,
            unassigned: filtered.length,
          },
          tagSummary: {
            total: candidates.length,
            open: candidates.length,
            overdue: 0,
          },
          tags: [{ id: 'tag-1', name: 'Special family', color: '#555' }],
          owners: [],
          tagGroups,
        },
        error: null,
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '?screen=pipeline');
  await page
    .getByRole('textbox', { name: 'Search deals, customers, phone, or tags…' })
    .waitFor();
  await page.clock.runFor(500);
  await page
    .getByRole('button', { name: 'Open Deal 1', exact: true })
    .waitFor();
  assert.equal(await page.locator('article.crm-smart-deal').count(), 12);
  await page
    .getByRole('button', { name: 'Next deals · Stage A', exact: true })
    .click();
  await page.clock.runFor(300);
  await page
    .getByRole('button', { name: 'Open Deal 13', exact: true })
    .waitFor();
  assert.equal(pipelineRequests.at(-1).p_stage_pages['stage-a'], 1);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.clock.runFor(300);
  await page.locator('tbody tr').first().waitFor();
  assert.equal(await page.locator('tbody tr').count(), 25);
  await page.getByRole('button', { name: 'Next deals', exact: true }).click();
  await page.clock.runFor(300);
  await page
    .getByRole('button', { name: 'Open Deal 26', exact: true })
    .waitFor();
  await page
    .getByRole('textbox', { name: 'Search deals, customers, phone, or tags…' })
    .fill('Deal 1500');
  await page.clock.runFor(300);
  await page
    .getByRole('button', { name: 'Open Deal 1500', exact: true })
    .waitFor();
  assert.equal(pipelineRequests.at(-1).p_page, 0);
  await page
    .getByRole('textbox', { name: 'Search deals, customers, phone, or tags…' })
    .fill('');
  await page.clock.runFor(300);
  await page
    .getByRole('button', { name: 'Open Deal 1', exact: true })
    .waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV', exact: true }).click(),
  ]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.split('\r\n').length, 1501);
  assert.ok(csv.includes('Deal 1500'));
  assert.equal(
    pipelineRequests.filter((args) => args.p_view === 'export').length,
    15
  );
  await page
    .getByRole('button', { name: 'Customer tags', exact: true })
    .click();
  await page.clock.runFor(300);
  await page.locator('article.crm-smart-deal').first().waitFor();
  assert.equal(await page.locator('article.crm-smart-deal').count(), 6);
  await page
    .locator('.crm-tag-tile')
    .filter({ hasText: 'Special family' })
    .click();
  await page.clock.runFor(300);
  await page.locator('article.crm-smart-deal').first().waitFor();
  assert.equal(pipelineRequests.at(-1).p_filters.tag, 'tag-1');
  assert.equal(await page.locator('article.crm-smart-deal').count(), 6);
  await page
    .getByRole('combobox', { name: 'Move Deal 1 to stage', exact: true })
    .selectOption('stage-b');
  await page.clock.runFor(300);
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Move Deal 1 to stage"]')
        ?.value === 'stage-b'
  );
  assert.equal(moved.get('deal-1'), 'stage-b');
  const heldProfiles = new Map(),
    seen = new Map(),
    profileReads = [];
  const waitForProfile = (user) =>
    new Promise((resolve) => seen.set(user, resolve));
  await page.route('**/__fixture/account-profile', (route) => {
    const user = route.request().headers()['x-fixture-user'];
    profileReads.push(user);
    heldProfiles.set(user, route);
    seen.get(user)?.();
  });
  const fulfillProfile = (user) =>
    heldProfiles
      .get(user)
      .fulfill({
        json: {
          data: {
            profile: {
              id: 'profile-' + user,
              user_id: user,
              full_name: user,
              email: user + '@example.test',
              account_id: 'account-' + user,
              account_role: 'owner',
              beta_features: [],
            },
            account: {
              id: 'account-' + user,
              name: user,
              default_currency: 'QAR',
            },
          },
          error: null,
        },
      });
  const sawA = waitForProfile('auth-a');
  await page.goto(origin + '?screen=auth');
  await sawA;
  assert.equal(profileReads.filter((user) => user === 'auth-a').length, 1);
  const sawB = waitForProfile('auth-b');
  await page.evaluate(() => window.fixtureAuth('auth-b'));
  await sawB;
  await fulfillProfile('auth-b');
  await page.locator('[data-profile="auth-b"]').waitFor();
  await fulfillProfile('auth-a');
  await page.evaluate(() => window.resolveFixtureSession());
  await page.waitForTimeout(30);
  assert.equal(
    await page.locator('[data-auth-user]').getAttribute('data-auth-user'),
    'auth-b'
  );
  assert.equal(
    await page.locator('[data-profile]').getAttribute('data-profile'),
    'auth-b'
  );
  const sawC = waitForProfile('auth-c');
  await page.evaluate(() => window.fixtureAuth('auth-c'));
  await sawC;
  await page.evaluate(() => window.fixtureAuth(null));
  await fulfillProfile('auth-c');
  await page.waitForTimeout(30);
  assert.equal(
    await page.locator('[data-auth-user]').getAttribute('data-auth-user'),
    ''
  );
  assert.equal(
    await page.locator('[data-profile]').getAttribute('data-profile'),
    ''
  );
  assert.equal(
    await page.locator('[data-account]').getAttribute('data-account'),
    ''
  );
  assert.deepEqual(errors, []);
  console.log(
    'Production-component browser checks passed: hidden-tab incoming calls, disabled polling, activation, bounded quotation pages, server search, retry, deal paging, mobile Arabic, scoped translations, bounded inbox loading/search reconnect reconciliation, global pipeline paging/search/tags/moves complete CSV export, one-call auth loading and stale session/profile race protection. Synthetic transport; no production latency claim.'
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await rm(root, { recursive: true, force: true });
}
