/** Real settings component; synthetic account/config only. No provider calls or real writes. */
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  realpath,
  mkdir,
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
  await mkdtemp(join(tmpdir(), 'wacrm-ai-settings-'))
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
    `export const useAuth=()=>({accountId:'synthetic', accountRole:new URLSearchParams(location.search).get('role')||'owner',profileLoading:false});`
  );
  await writeFile(
    join(root, 'children.tsx'),
    `export const SalesAssistanceSettings=()=>null;export const ProductCatalogPanel=()=>null;export const BusinessHoursCard=()=>null;export const SocialLinksCard=()=>null;`
  );
  await writeFile(
    join(root, 'main.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {AiConfig} from ${JSON.stringify(join(project, 'src/components/settings/ai-config.tsx'))};import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};import ${JSON.stringify(join(project, 'src/app/globals.css'))};import ${JSON.stringify(join(project, 'src/app/design-system.css'))};const locale=new URLSearchParams(location.search).get('locale')||'en';document.documentElement.dir=locale==='ar'?'rtl':'ltr';createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><main className="mx-auto max-w-6xl p-4"><AiConfig/></main></NextIntlClientProvider>);`
  );
  const aliases = [
    { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
    ...[
      'sales-assistance-settings',
      'product-catalog-panel',
      'business-hours-card',
      'social-links-card',
    ].map((name) => ({
      find: `./${name}`,
      replacement: join(root, 'children.tsx'),
    })),
    { find: '@', replacement: join(project, 'src') },
  ];
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: aliases },
    css: { postcss: { plugins: [tailwind()] } },
    esbuild: { jsx: 'automatic' },
    build: {
      outDir: join(root, 'dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000,
    },
  });
  server = await preview({
    root,
    configFile: false,
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0 },
    build: { outDir: join(root, 'dist') },
  });
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  let mutations = 0;
  const errors = [];
  const config = {
    configured: true,
    provider: 'openai',
    model: 'gpt-5.4',
    has_key: true,
    is_active: true,
    auto_reply_enabled: true,
    auto_reply_max_per_conversation: 0,
  };
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== new URL(url).origin) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      if (route.request().method() !== 'GET') {
        mutations++;
        return route.fulfill({
          json: { error: 'No synthetic writes allowed' },
          status: 400,
        });
      }
      return route.fulfill({
        json: u.pathname === '/api/ai/config' ? config : { members: [] },
      });
    }
    return route.continue();
  });
  for (const locale of ['en', 'ar'])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(url + `?locale=${locale}`);
      await page.locator('#ai-model').waitFor();
      await expectValue(page, 'gpt-5.4');
      for (const id of ['gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-luna'])
        assert.equal(
          await page.getByRole('button').filter({ hasText: id }).count(),
          1
        );
      await page
        .getByRole('button')
        .filter({ hasText: 'gpt-6.1-terra' })
        .click();
      await expectValue(page, 'gpt-6.1-terra');
      await page.locator('#ai-model').fill('custom-supported-id');
      await expectValue(page, 'custom-supported-id');
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false,
        `${locale} ${width} overflow`
      );
      await mkdir(join(project, '.local/ai-reliability'), { recursive: true });
      await page.screenshot({
        path: join(
          project,
          `.local/ai-reliability/settings-${locale}-${width}.png`
        ),
        fullPage: true,
      });
    }
  await page.goto(url + '?role=viewer');
  await page.locator('#ai-model').waitFor();
  assert.equal(await page.locator('#ai-model').isDisabled(), true);
  assert.equal(mutations, 0);
  assert.deepEqual(errors, []);
  console.log(
    'AI settings browser checks passed: EN/AR, mobile/desktop, saved/custom models, recommended choices, viewer read-only, no writes.'
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await rm(root, { recursive: true, force: true });
}
async function expectValue(page, value) {
  await page.waitForFunction(
    (value) => document.getElementById('ai-model')?.value === value,
    value
  );
}
