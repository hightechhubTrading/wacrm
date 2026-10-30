/** Actual composer + draft store, synthetic auth/media/AI; blocks external requests. */
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = await realpath(await mkdtemp(join(tmpdir(), 'wacrm-experience-')));
let server, browser, debugPage;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.tsx'),
    `import React,{createContext,useContext} from 'react';
    export const Auth=createContext(null); export const useAuth=()=>useContext(Auth);`
  );
  await writeFile(join(root, 'can.ts'), `export const useCan=()=>true;`);
  await writeFile(
    join(root, 'supabase.ts'),
    `const db={auth:{getUser:async()=>({data:{user:{id:'fixture-user'}},error:null})},from:()=>{const b={};for(const m of ['select','eq','order'])b[m]=()=>b;b.then=(r)=>Promise.resolve({data:[{id:'template',name:'synthetic_followup',language:'en_US',body_text:'Hello {{1}}',header_type:'none',buttons:[],status:'APPROVED'}],error:null}).then(r);return b;}};export const createClient=()=>db;`
  );
  await writeFile(
    join(root, 'pickers.tsx'),
    `export const QuickReplyPicker=()=>null; export const CatalogPickerDialog=()=>null;`
  );
  await writeFile(
    join(root, 'media.ts'),
    `export const MEDIA_MAX_BYTES_BY_KIND={image:5242880,video:16777216,document:104857600,audio:16777216};
    export const deleteAccountMedia=async(bucket,path)=>{window.deleted.push(path)};
    export const uploadAccountMedia=async(bucket,file)=>{
      if(window.holdUpload) await new Promise(resolve=>{window.finishUpload=resolve});
      return {publicUrl:'/image.svg',path:'synthetic/'+file.name};};`
  );
  await writeFile(
    join(root, 'recorder.ts'),
    `export default class Recorder {
    async start(){if(window.holdRecording)await new Promise(resolve=>{window.finishRecording=resolve});window.micOpen=true;}
    async stop(){window.micOpen=false;window.micStops=(window.micStops||0)+1;}
  }`
  );
  await writeFile(
    join(root, 'main.tsx'),
    `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {NextIntlClientProvider} from 'next-intl'; import {Auth} from './auth';
    import {MessageComposer} from ${JSON.stringify(join(project, 'src/components/inbox/message-composer.tsx'))};
    import {sendTrackedMessage} from ${JSON.stringify(join(project, 'src/lib/inbox/send-outcome.ts'))};
    import {clearDrafts,draftScope} from ${JSON.stringify(join(project, 'src/lib/inbox/drafts.ts'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))}; import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};
    import ${JSON.stringify(join(project, 'src/app/design-system.css'))};
    import ${JSON.stringify(join(project, 'src/app/inbox-workspace.css'))};
    window.deleted=[];window.sent=[];
    const params=new URLSearchParams(location.search);const locale=params.get('locale')||'en';
    document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.lang=locale;document.documentElement.dataset.mode=params.has('dark')?'dark':'light';document.documentElement.classList.toggle('dark',params.has('dark'));
    function App(){const [conversation,setConversation]=useState('A');const [account,setAccount]=useState('account');const [user,setUser]=useState('user');const [loggedIn,setLoggedIn]=useState(true);const [templateOpen,setTemplateOpen]=useState(false);const [expired,setExpired]=useState(false);
      const identity={accountId:account,user:{id:user}};
      function changeAccount(){clearDrafts(draftScope(account,user));setAccount(account==='account'?'other':'account');}
      return <Auth.Provider value={identity}><NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar">
        <div className="crm-workspace"><div className="crm-inbox"><nav><button onClick={()=>setConversation('A')}>Customer A</button><button onClick={()=>setConversation('B')}>Customer B</button>
        <button onClick={changeAccount}>Switch account</button><button onClick={()=>{clearDrafts();setUser(user==='user'?'other-user':'user')}}>Switch user</button>
        <button onClick={()=>{clearDrafts();setLoggedIn(false)}}>Logout</button><button onClick={()=>setLoggedIn(true)}>Login</button></nav>
        <button onClick={()=>setExpired(!expired)}>Toggle session</button><p>Current: {account}/{user}/{conversation}</p>
        {loggedIn&&<MessageComposer conversationId={conversation} sessionExpired={expired}
          onSend={(text,reply,id)=>{window.sent.push({conversation,text,id});return sendTrackedMessage({conversation_id:conversation,message_type:'text',content_text:text},id)}} onSendMedia={(media,id)=>{window.sent.push({conversation,media,id});return sendTrackedMessage({conversation_id:conversation,message_type:media.kind,media_url:media.mediaUrl},id)}}
          onSendInteractive={(payload,reply,id)=>sendTrackedMessage({conversation_id:conversation,message_type:'interactive',interactive_payload:payload},id)} onOpenTemplates={()=>setTemplateOpen(true)} templatePickerOpen={templateOpen} onTemplatePickerOpenChange={setTemplateOpen}
          onSendTemplate={(draft,id)=>{window.sent.push({conversation,template:draft,id});return sendTrackedMessage({conversation_id:conversation,message_type:'template',template_name:draft.name,template_message_params:draft.values},id)}}/>}</div></div>
      </NextIntlClientProvider></Auth.Provider>;
    }createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
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
        { find: '@/hooks/use-can', replacement: join(root, 'can.ts') },
        {
          find: '@/lib/supabase/client',
          replacement: join(root, 'supabase.ts'),
        },
        {
          find: '@/lib/storage/upload-media',
          replacement: join(root, 'media.ts'),
        },
        {
          find: /^\.\/quick-reply-picker$|^\.\/catalog-picker-dialog$/,
          replacement: join(root, 'pickers.tsx'),
        },
        { find: 'opus-recorder', replacement: join(root, 'recorder.ts') },
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
  });
  const page = await context.newPage();
  debugPage = page;
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('Browser error:', e.message);
  });
  let pendingDraft, pendingTranslation;
  let sendMode = 'accepted',
    postCount = 0;
  const operations = new Map();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname === '/api/whatsapp/send') {
      const request = route.request();
      if (request.method() === 'GET') {
        const op = operations.get(url.searchParams.get('operation_id'));
        return route.fulfill({
          json: op ?? { outcome: 'unknown', code: 'not_found' },
        });
      }
      postCount++;
      const body = request.postDataJSON();
      const result =
        sendMode === 'accepted' || sendMode === 'lost-response'
          ? {
              success: true,
              outcome: 'accepted',
              message_id: 'saved',
              whatsapp_message_id: 'wamid',
            }
          : {
              outcome: sendMode,
              code: sendMode === 'rejected' ? 'meta_rejected' : 'meta_error',
            };
      operations.set(body.operation_id, result);
      if (sendMode === 'lost-response') return route.abort();
      return route.fulfill({
        status: sendMode === 'accepted' ? 200 : 502,
        json: result,
      });
    }
    if (url.pathname === '/api/ai/draft') {
      pendingDraft = route;
      return;
    }
    if (url.pathname === '/api/ai/translate') {
      pendingTranslation = route;
      return;
    }
    if (url.pathname === '/image.svg')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      });
    if (url.pathname.startsWith('/api/'))
      return route.fulfill({
        status: 500,
        json: { error: 'Fixture blocked unmocked endpoint' },
      });
    return route.continue();
  });
  const textarea = () => page.locator('textarea').first();
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Fixture request did not arrive');
  };
  await page.goto(origin);
  await textarea().fill('Customer A draft');
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  assert.equal(await textarea().inputValue(), '');
  await textarea().fill('Customer B draft');
  await page.getByRole('button', { name: 'Customer A', exact: true }).click();
  assert.equal(await textarea().inputValue(), 'Customer A draft');
  await page.reload();
  await textarea().waitFor();
  assert.equal(await textarea().inputValue(), 'Customer A draft');
  const secondTab = await page.context().newPage();
  await secondTab.goto(origin);
  await secondTab.locator('textarea').first().waitFor();
  assert.equal(
    await secondTab.locator('textarea').first().inputValue(),
    'Customer A draft'
  );
  await secondTab.locator('textarea').first().fill('Updated from second tab');
  await page.waitForFunction(
    () =>
      document.querySelector('textarea')?.value === 'Updated from second tab'
  );
  await secondTab.close();
  await textarea().fill('Customer A draft');
  // AI cannot destroy a manual draft or late edits.
  await page
    .getByRole('button', { name: 'Draft a reply with AI', exact: true })
    .click();
  await waitFor(() => pendingDraft);
  await textarea().fill('Edited while waiting');
  await pendingDraft.fulfill({ json: { draft: 'AI suggestion' } });
  pendingDraft = null;
  await page
    .getByRole('button', { name: 'Insert below', exact: true })
    .waitFor();
  assert.equal(await textarea().inputValue(), 'Edited while waiting');
  await page.getByRole('button', { name: 'Insert below', exact: true }).click();
  assert.equal(
    await textarea().inputValue(),
    'Edited while waiting\nAI suggestion'
  );
  // A request started in A cannot affect B, even if it completes after switching.
  await page
    .getByRole('button', { name: 'Draft a reply with AI', exact: true })
    .click();
  await waitFor(() => pendingDraft);
  const abandoned = pendingDraft;
  pendingDraft = null;
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  await abandoned
    .fulfill({ json: { draft: 'Wrong customer response' } })
    .catch(() => {});
  assert.equal(await textarea().inputValue(), 'Customer B draft');
  // Translation preserves text edited while waiting, offering explicit replacement.
  await page
    .getByRole('button', { name: 'Translate this message', exact: true })
    .click();
  await waitFor(() => pendingTranslation);
  await textarea().fill('Newer B text');
  await pendingTranslation.fulfill({ json: { translation: 'ترجمة' } });
  pendingTranslation = null;
  await page
    .getByRole('button', { name: 'Replace draft', exact: true })
    .waitFor();
  assert.equal(await textarea().inputValue(), 'Newer B text');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  // Definite rejection preserves text. Editing/retry creates a new operation.
  sendMode = 'rejected';
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit message', exact: true })
    .waitFor();
  assert.equal(await textarea().inputValue(), 'Newer B text');
  assert.equal(postCount, 1);
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  sendMode = 'accepted';
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea')?.value === ''
  );
  assert.equal(postCount, 2);
  const attempts = await page.evaluate(() => window.sent);
  assert.notEqual(attempts[0].id, attempts[1].id);
  // Acceptance with a lost HTTP response is reconciled without another POST.
  sendMode = 'lost-response';
  await textarea().fill('Response lost');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea')?.value === ''
  );
  assert.equal(postCount, 3);
  // Unknown sends remain locked across navigation and reload. Read-only reconciliation
  // clears only the originating conversation when provider acceptance is confirmed.
  sendMode = 'unknown';
  await textarea().fill('Uncertain message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page
    .getByText('Acceptance is not confirmed.', { exact: false })
    .waitFor();
  assert.equal(await textarea().isDisabled(), true);
  const uncertainId = await page.evaluate(() => window.sent.at(-1).id);
  await page.getByRole('button', { name: 'Customer A', exact: true }).click();
  assert.equal(await textarea().isDisabled(), false);
  await page.reload();
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  assert.equal(await textarea().inputValue(), 'Uncertain message');
  assert.equal(await textarea().isDisabled(), true);
  // A late edit from another tab must not be erased when the older send is reconciled.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('wacrm:draft:v1:') && k.endsWith(':B')
    );
    const draft = JSON.parse(localStorage.getItem(key));
    draft.text = 'Newer draft from another tab';
    localStorage.setItem(key, JSON.stringify(draft));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  operations.set(uncertainId, {
    success: true,
    outcome: 'accepted',
    message_id: 'saved',
    whatsapp_message_id: 'wamid',
  });
  await page
    .getByRole('button', { name: 'Check send result', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea')?.value ===
      'Newer draft from another tab'
  );
  assert.equal(postCount, 4);
  sendMode = 'accepted';
  await textarea().fill('');
  // Navigating while microphone permission/start is pending releases the eventual stream.
  await page.getByRole('button', { name: 'Customer A', exact: true }).click();
  await page.evaluate(() => {
    window.holdRecording = true;
    window.micStops = 0;
  });
  await page.getByRole('button', { name: 'Attach media', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Voice note', exact: true }).click();
  await page.waitForFunction(
    () => typeof window.finishRecording === 'function'
  );
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  await page.evaluate(() => window.finishRecording());
  await page.waitForFunction(
    () => window.micOpen === false && window.micStops >= 2
  );
  // An incomplete interactive draft remains editable and survives reopening.
  await page.getByRole('button', { name: 'Attach media', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Interactive message', exact: true })
    .click();
  const builder = page.getByRole('dialog');
  await builder.locator('textarea').first().fill('Choose an option');
  await builder.getByPlaceholder('Button label').fill('First option');
  assert.equal(
    await builder.locator('textarea').first().inputValue(),
    'Choose an option'
  );
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  await page.getByRole('button', { name: 'Attach media', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Interactive message', exact: true })
    .click();
  assert.equal(
    await page.getByRole('dialog').locator('textarea').first().inputValue(),
    'Choose an option'
  );
  await page.keyboard.press('Escape');
  // Complete uploads survive navigation/reload, but stay scoped to the customer.
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('synthetic'),
    });
  await page.locator('img[alt="photo.png"]').waitFor();
  await page.getByRole('button', { name: 'Customer A', exact: true }).click();
  assert.equal(await page.locator('img[alt="photo.png"]').count(), 0);
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  await page.locator('img[alt="photo.png"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.deleted), []);
  // An upload finishing after navigation is cleaned up, never attached to B.
  await page.getByRole('button', { name: 'Customer A', exact: true }).click();
  await page.evaluate(() => {
    window.holdUpload = true;
  });
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'late.png',
      mimeType: 'image/png',
      buffer: Buffer.from('synthetic'),
    });
  await page.waitForFunction(() => typeof window.finishUpload === 'function');
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  await page.evaluate(() => window.finishUpload());
  await page.waitForFunction(() =>
    window.deleted.includes('synthetic/late.png')
  );
  assert.equal(await page.locator('img[alt="late.png"]').count(), 0);
  // A rejected attachment is retained for recovery rather than deleted prematurely.
  sendMode = 'rejected';
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit message', exact: true })
    .waitFor();
  await page.locator('img[alt="photo.png"]').waitFor();
  assert.equal(
    await page.evaluate(() => window.deleted.includes('synthetic/photo.png')),
    false
  );
  await page
    .getByRole('button', { name: 'Discard draft', exact: true })
    .click();
  await page.waitForFunction(() =>
    window.deleted.includes('synthetic/photo.png')
  );
  sendMode = 'accepted';
  // Templates use the same recovery ledger outside the free-form session window.
  await textarea().fill('Keep my personal draft');
  await page
    .getByRole('button', { name: 'Toggle session', exact: true })
    .click();
  sendMode = 'rejected';
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /synthetic_followup/ })
    .click();
  await page.getByLabel('Message value 1', { exact: true }).fill('Customer');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Send template', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit message', exact: true })
    .waitFor();
  assert.equal(await textarea().inputValue(), 'Keep my personal draft');
  await page.reload();
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await page.getByLabel('Message value 1', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Message value 1', { exact: true }).inputValue(),
    'Customer'
  );
  await page
    .getByLabel('Message value 1', { exact: true })
    .fill('Customer updated');
  sendMode = 'accepted';
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Send template', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page
    .getByRole('button', { name: 'Edit message', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(await textarea().inputValue(), 'Keep my personal draft');
  // Account/user changes and logout discard customer content.
  await page
    .getByRole('button', { name: 'Switch account', exact: true })
    .click();
  assert.equal(await textarea().inputValue(), '');
  await page
    .getByRole('button', { name: 'Switch account', exact: true })
    .click();
  assert.equal(await textarea().inputValue(), '');
  await textarea().fill('private');
  await page.getByRole('button', { name: 'Switch user', exact: true }).click();
  assert.equal(await textarea().inputValue(), '');
  await textarea().fill('private again');
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  assert.equal(await textarea().inputValue(), '');
  // Phone/Arabic renders and persists correctly with the production styles.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '?locale=ar');
  await textarea().fill('مسودة العميل');
  await page.getByRole('button', { name: 'Customer B', exact: true }).click();
  assert.equal(await textarea().inputValue(), '');
  await page.getByRole('button', { name: 'Customer A', exact: true }).click();
  assert.equal(await textarea().inputValue(), 'مسودة العميل');
  assert.deepEqual(errors, []);
  console.log(
    'Composer browser checks passed: isolation, reload, late AI/translation, attachment ownership, auth clearing, Arabic phone.'
  );
} catch (error) {
  if (debugPage)
    console.error((await debugPage.locator('body').innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser?.close();
  await new Promise(
    (resolve) => server?.httpServer.close(resolve) ?? resolve()
  );
  await rm(root, { recursive: true, force: true });
}
