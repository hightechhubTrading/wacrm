/** Synthetic browser checks using installed Chrome. No CRM/provider connections. */
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const chrome =
  process.env.CHROME_EXECUTABLE ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome))
  throw new Error(
    'Use an existing Chrome installation; this test never downloads browsers.'
  );
const en = JSON.parse(readFileSync('messages/en.json')).NotificationCenter;
const ar = JSON.parse(readFileSync('messages/ar.json')).NotificationCenter;
const result = await build({
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {NotificationPreferences} from '@/components/notifications/preferences';
import {NotificationForeground} from '@/components/notifications/foreground';
import {NotificationTaskActions} from '@/components/notifications/task-actions';
window.calls=[]; window.toasts=[]; window.changes=0; window.callbacks=[]; window.settings={foreground:true,sound:false,supervise:false,categories:['followups'],quiet:null};
const channel={on:(event,filter,cb)=>{window.callbacks.push({filter,cb});return channel;},subscribe:cb=>{cb('SUBSCRIBED');return channel;}};
window.fakeDB={channel:()=>channel,removeChannel:()=>{},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{push_categories:['followups']},error:null})};return q;},rpc:async(name,args)=>{window.calls.push({name,args});return {error:null};}};
window.fetch=async(url,options)=>{if(!options||!options.method)return {ok:true,json:async()=>window.settings};window.calls.push({url,body:JSON.parse(options.body)});return {ok:!window.fail};};
createRoot(document.getElementById('root')).render(<><NotificationForeground/><NotificationPreferences accountId="account" userId="user"/><NotificationTaskActions notice={{id:'notice',conversation_id:'conversation',followup_id:'task'}} onChange={()=>window.changes++}/></>);
`,
  },
  plugins: [
    {
      name: 'synthetic-services',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(next-intl|sonner|@\/lib\/supabase\/client|@\/hooks\/use-auth)$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' })
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'js',
          contents:
            args.path === '@/hooks/use-auth'
              ? `export const useAuth=()=>({accountRole:'agent',accountId:'account',user:{id:'user'}});`
              : args.path === 'next-intl'
                ? `export const useTranslations=()=>key=>(${JSON.stringify({ en, ar })})[new URLSearchParams(location.search).get('lang')||'en'][key]||key;`
                : args.path === 'sonner'
                  ? `export const toast=Object.assign(text=>window.toasts.push(text),{success:text=>window.toasts.push(text),error:text=>window.toasts.push(text)});`
                  : `export const createClient=()=>window.fakeDB;`,
        }));
      },
    },
  ],
});
const server = createServer((request, response) => {
  response.setHeader(
    'Content-Type',
    request.url === '/bundle.js' ? 'text/javascript' : 'text/html'
  );
  response.end(
    request.url === '/bundle.js'
      ? result.outputFiles[0].text
      : '<div id="root"></div><script src="/bundle.js"></script>'
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const context = await browser.newContext({ timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort()
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.locator('summary').filter({ hasText: en.pushPreferences }).click();
  await page.getByLabel(en.system, { exact: true }).check();
  await page.getByRole('button', { name: en.save, exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls[0]), {
    name: 'set_notification_categories',
    args: { p_account: 'account', p_categories: ['followups', 'system'] },
  });
  await page.getByText(en.taskActions, { exact: true }).first().click();
  await page.getByRole('button', { name: en.apply, exact: true }).click();
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((c) => c.body?.id === 'task').body
    ),
    {
      id: 'task',
      status: 'acknowledged',
    }
  );
  assert.equal(await page.evaluate(() => window.changes), 1);
  await page.reload();
  await page.getByText(en.taskActions, { exact: true }).first().click();
  await page.locator('select').selectOption('completed');
  await page.getByRole('textbox').fill('Work checked and completed');
  await page.getByRole('button', { name: en.apply, exact: true }).click();
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((c) => c.body?.id === 'task').body
    ),
    {
      id: 'task',
      status: 'completed',
      completion_evidence: 'Work checked and completed',
    }
  );
  await page.reload();
  await page.getByText(en.taskActions, { exact: true }).first().click();
  await page.locator('select').selectOption('deferred');
  await page.locator('input[type=datetime-local]').fill('2099-01-02T10:00');
  await page.getByRole('button', { name: en.apply, exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => window.calls.find((c) => c.body?.id === 'task').body.due_at
    ),
    '2099-01-02T09:00:00.000Z'
  );
  await page.reload();
  await page.getByText(en.taskActions, { exact: true }).first().click();
  await page.evaluate(() => (window.fail = true));
  await page.getByRole('button', { name: en.apply, exact: true }).click();
  assert.equal(await page.evaluate(() => window.changes), 0);
  assert.equal(
    await page.getByRole('button', { name: en.apply, exact: true }).count(),
    1
  );
  await page.goto(base + '?lang=ar');
  assert.equal(
    await page
      .locator('summary')
      .filter({ hasText: ar.pushPreferences })
      .count(),
    1
  );

  await page.goto(base);
  const other = await context.newPage();
  await other.goto(base);
  await other.bringToFront();
  await page.evaluate(() => {
    window.toasts = [];
    window.fixtureFocused = false;
    document.hasFocus = () => window.fixtureFocused;
  });
  await other.evaluate(() => {
    window.toasts = [];
    window.fixtureFocused = true;
    document.hasFocus = () => window.fixtureFocused;
  });
  await other.waitForFunction(() => window.callbacks.length > 0);
  const emit = async (tab) =>
    tab.evaluate(() =>
      window.callbacks
        .find((c) => c.filter.table === 'notifications')
        .cb({
          new: {
            id: 'shared-event',
            account_id: 'account',
            category: 'followups',
            priority: 'high',
            title: 'Synthetic alert',
            created_at: new Date().toISOString(),
          },
        })
    );
  await emit(page);
  await emit(other);
  await other.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.toasts.length),
    0,
    'unfocused tab stays quiet'
  );
  assert.equal(
    await other.evaluate(() => window.toasts.length),
    1,
    'focused tab shows one alert'
  );
  await page.bringToFront();
  await page.evaluate(() => (window.fixtureFocused = true));
  await other.evaluate(() => (window.fixtureFocused = false));
  await emit(page);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.toasts.length),
    0,
    'same event remains suppressed after tab switch'
  );
  await other.close();
  console.log(
    'PASS synthetic browser preferences, task acknowledgment/completion/deferral, local timezone, failed-action preservation and Arabic labels'
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
