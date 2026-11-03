/** Real follow-up editor with synthetic transport; no live writes or messages. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = process.cwd(),
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'hth-followup-'))
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
    'export const useAuth=()=>({canSendMessages:true});'
  );
  await fs.writeFile(
    path.join(root, 'navigation.ts'),
    'export const useSearchParams=()=>new URLSearchParams();'
  );
  await fs.writeFile(
    path.join(root, 'main.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {AiFollowups} from ${JSON.stringify(path.join(project, 'src/components/inbox/ai-followups.tsx'))};import en from ${JSON.stringify(path.join(project, 'messages/en.json'))};import ar from ${JSON.stringify(path.join(project, 'messages/ar.json'))};import ${JSON.stringify(path.join(project, 'src/app/globals.css'))};import ${JSON.stringify(path.join(project, 'src/app/inbox-workspace.css'))};const q=new URLSearchParams(location.search),locale=q.get('locale')||'en';document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.dataset.mode=q.get('mode');document.documentElement.classList.toggle('dark',q.get('mode')==='dark');document.documentElement.dataset.theme='navy-gold';createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en}><main style={{padding:16,maxWidth:460}}><AiFollowups conversationId="synthetic" standalone/></main></NextIntlClientProvider>);`
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
          find: 'next/navigation',
          replacement: path.join(root, 'navigation.ts'),
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
  await fs.mkdir('.local/followup-ui', { recursive: true });
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1200]) {
        const t = JSON.parse(
          await fs.readFile(`messages/${locale}.json`, 'utf8')
        ).Inbox.followups;
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          timezoneId: 'Europe/Berlin',
        });
        page.setDefaultTimeout(10000);
        page.on('pageerror', (e) => errors.push(e.message));
        await page.clock.setFixedTime(new Date('2026-11-03T06:15:00Z'));
        const writes = [];
        await page.route('**/api/ai/followups/**', async (route) => {
          const r = route.request();
          if (r.method() !== 'GET') {
            writes.push(r.postDataJSON());
            await route.fulfill({ json: { success: true, id: 'task' } });
            return;
          }
          await route.fulfill({
            json: {
              available: true,
              followups: [
                {
                  id: 'task',
                  kind: 'quotation',
                  status: 'acknowledged',
                  due_at: '2026-11-04T06:15:00Z',
                  confirmed_at: null,
                  owner_id: 'synthetic',
                  completion_evidence: null,
                },
              ],
              latestEvent: null,
              conversation: {
                assigned_agent_id: 'synthetic',
                ai_autoreply_disabled: false,
              },
            },
          });
        });
        await page.goto(
          server.resolvedUrls.local[0] + `?locale=${locale}&mode=${mode}`
        );
        const update = () =>
          page.getByRole('button', { name: t.update, exact: true }).click();
        await page
          .getByRole('combobox', { name: t.newTask, exact: true })
          .click();
        await page
          .getByRole('option', { name: t.kinds.inspection, exact: true })
          .click();
        await page.getByRole('button', { name: t.create, exact: true }).click();
        await page.waitForFunction(
          () => document.querySelectorAll('button:disabled').length === 0
        );
        assert.equal(writes[0].kind, 'inspection');
        await update();
        assert.equal(
          await page.locator('select:visible').count(),
          0,
          'OS-native select remains visible'
        );
        await page
          .getByRole('combobox', { name: t.evidence, exact: true })
          .click();
        await page
          .getByRole('option', { name: t.outcomes.quotationSent, exact: true })
          .click();
        await page
          .getByLabel(t.optionalDetails, { exact: true })
          .fill('Reference HT-26-WS-901');
        await page
          .getByRole('button', { name: t.complete, exact: true })
          .click();
        await page.locator('.crm-followup-editor').waitFor({ state: 'hidden' });
        assert.equal(
          writes.at(-1).completion_evidence,
          t.outcomes.quotationSent + ' — Reference HT-26-WS-901'
        );
        await update();
        await page
          .getByRole('combobox', { name: t.evidence, exact: true })
          .click();
        await page
          .getByRole('option', { name: t.customOutcome, exact: true })
          .click();
        assert.equal(
          await page
            .getByRole('button', { name: t.complete, exact: true })
            .isDisabled(),
          true
        );
        await page
          .getByLabel(t.customEvidence, { exact: true })
          .fill('Custom work performed and checked');
        await page
          .getByRole('button', { name: t.complete, exact: true })
          .click();
        await page.locator('.crm-followup-editor').waitFor({ state: 'hidden' });
        assert.equal(
          writes.at(-1).completion_evidence,
          'Custom work performed and checked'
        );
        await update();
        const appointment = page.getByRole('group', {
          name: t.confirmedTime,
          exact: true,
        });
        await appointment
          .getByRole('button', { name: t.today, exact: true })
          .click();
        assert.equal(
          await appointment
            .getByLabel(t.confirmedTime + ' — ' + t.time, { exact: true })
            .inputValue(),
          '09:15'
        );
        await page
          .getByRole('button', { name: t.confirm, exact: true })
          .click();
        await page.locator('.crm-followup-editor').waitFor({ state: 'hidden' });
        assert.equal(writes.at(-1).confirmed_at, '2026-11-03T06:15:00.000Z');
        await update();
        const defer = page.getByRole('group', {
          name: t.deferUntil,
          exact: true,
        });
        await defer.getByRole('button', { name: t.today, exact: true }).click();
        await page.getByRole('button', { name: t.defer, exact: true }).click();
        await page.locator('.crm-followup-editor').waitFor({ state: 'hidden' });
        assert.equal(writes.at(-1).due_at, '2026-11-03T06:45:00.000Z');
        await update();
        await page
          .getByRole('group', { name: t.deferUntil, exact: true })
          .getByRole('button', { name: t.tomorrow, exact: true })
          .click();
        await page.getByRole('button', { name: t.defer, exact: true }).click();
        await page.locator('.crm-followup-editor').waitFor({ state: 'hidden' });
        assert.equal(writes.at(-1).due_at, '2026-11-04T06:15:00.000Z');
        await update();
        await page
          .getByRole('button', { name: t.confirmedTime, exact: true })
          .click();
        await page.locator('.qw-calendar').waitFor();
        assert.equal(
          await page.locator('.qw-calendar-presets:visible').count(),
          0
        );
        await page.keyboard.press('Escape');
        await page
          .getByRole('group', { name: t.confirmedTime, exact: true })
          .getByRole('button', { name: t.today, exact: true })
          .click();
        await page
          .getByRole('combobox', { name: t.evidence, exact: true })
          .click();
        await page
          .getByRole('option', {
            name: t.outcomes.quotationPrepared,
            exact: true,
          })
          .click();
        await page.getByRole('listbox').waitFor({ state: 'hidden' });
        await page.screenshot({
          path: `.local/followup-ui/${locale}-${mode}-${width}.png`,
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          true,
          'Form overflows'
        );
        await page.close();
        cases++;
      }
  assert.deepEqual(errors, []);
  console.log(
    `${cases} follow-up form journeys passed: styled dropdowns, preset/custom completion evidence, Today/Tomorrow Qatar timestamps, calendar and mobile/RTL themes. No live writes.`
  );
} finally {
  await browser?.close();
  await new Promise((r) => server?.httpServer.close(r) ?? r());
  await fs.rm(root, { recursive: true, force: true });
}
