/** Production React components with a synthetic transport; no account writes. */
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = "/Volumes/Extreme SSD/Projects/Hitechub Qatar/SYS/wacrm";
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
      <NextIntlClientProvider locale={locale} timeZone="Asia/Qatar" messages={route ? routeMessages(catalog,route):sharedMessages(catalog)}><main className="crm-workspace crm-main p-4">{screen==='auth'?<AuthFixture/>:screen==='pipeline'?<PipelineFixture/>:screen==='realtime'?<RealtimeFixture/>:screen==='inbox'?<InboxFixture/>:screen==='quotes'?<QuotationList/>:screen==='deal'?<QuotationsDialog open onOpenChange={()=>{}} dealId="deal-1" contactId="contact-1"/>:<CallingProvider><Probe/></CallingProvider>}</main><Toaster/></NextIntlClientProvider>
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

  await page.route('**/*', route => {
    const url=new URL(route.request().url());
    if(url.origin!==new URL(origin).origin)return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{data:[],items:[]}});
    return route.continue();
  });
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

  const evidence=[];
  for(const locale of ['en','ar']) {
    await page.goto(origin+'?screen=pipeline&locale='+locale);
    await page.locator('article.crm-smart-deal').first().waitFor();
    for(const width of [390,1280]) for(const mode of ['light','dark']) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(mode=>{
        document.documentElement.style.setProperty('--font-sans','Arial, sans-serif');
        document.documentElement.style.setProperty('--font-arabic','Arial, sans-serif');
        document.documentElement.dataset.mode=mode;
        document.documentElement.dataset.theme='violet';
        document.documentElement.classList.toggle('dark',mode==='dark');
        document.querySelector('.crm-workspace').dataset.mode=mode;
      },mode);
      await page.waitForTimeout(200);
      await page.screenshot({path:'/tmp/wacrm-21st-audit/'+locale+'-'+width+'-'+mode+'.png',fullPage:false});
      const result=await page.evaluate(()=>({
        overflow:document.documentElement.scrollWidth>innerWidth,
        background:getComputedStyle(document.querySelector('.crm-workspace')).backgroundColor,
        text:getComputedStyle(document.querySelector('.crm-workspace')).color,
        inputs:[...document.querySelectorAll('input')].map(e=>({label:e.getAttribute('aria-label'),font:getComputedStyle(e).fontSize,width:e.getBoundingClientRect().width})),
        smallTargets:[...document.querySelectorAll('button,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24)}).slice(0,12).map(e=>({text:e.textContent,label:e.getAttribute('aria-label'),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))
      }));
      evidence.push({locale,width,mode,...result});
    }
  }
  await writeFile('/tmp/wacrm-21st-audit/evidence.json',JSON.stringify({evidence,errors},null,2));
  console.log(JSON.stringify({evidence,errors}));
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await rm(root, { recursive: true, force: true });
}
