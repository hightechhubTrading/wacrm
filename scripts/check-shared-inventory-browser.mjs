/** Render real shared inventory screens with synthetic, account-scoped responses. */
import {
  mkdtemp,
  realpath,
  symlink,
  writeFile,
  rm,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = resolve(fileURLToPath(new URL('..', import.meta.url))),
  root = await realpath(await mkdtemp(join(tmpdir(), 'shared-inventory-')));
let server, browser;
const id = '11111111-1111-4111-8111-111111111111';
const product = {
  id,
  name: 'Fixture shutter',
  description: 'Reviewed description',
  parent_id: null,
  kind: 'product',
  status: 'approved',
  customer_visible: true,
  inventory_type: 'product',
  sku: 'TEST-01',
  name_ar: 'شتر تجريبي',
  unit_of_measure: 'm2',
  aliases: [],
  specifications: '',
  limitations: '',
  source_notes: '',
  source_url: null,
  price_min: 350,
  price_max: 380,
  price_unit: 'per_square_meter',
  price_notes: 'Estimate',
  files: [],
};
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'link.tsx'),
    'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}'
  );
  await writeFile(
    join(root, 'navigation.ts'),
    'export function useSearchParams(){return new URLSearchParams(location.search)}'
  );
  await writeFile(
    join(root, 'auth.ts'),
    "export function useAuth(){return {accountId:'fixture-account',accountRole:'owner',profileLoading:false}}"
  );
  await writeFile(
    join(root, 'main.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {ProductCatalogPanel} from ${JSON.stringify(join(project, 'src/components/settings/product-catalog-panel.tsx'))};import ${JSON.stringify(join(project, 'src/app/globals.css'))};const locale=new URLSearchParams(location.search).get('locale')||'en';document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.lang=locale;createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={{}} timeZone="Europe/Berlin"><main className="mx-auto max-w-6xl p-4"><ProductCatalogPanel/></main></NextIntlClientProvider>);`
  );
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: 'next/link', replacement: join(root, 'link.tsx') },
        { find: 'next/navigation', replacement: join(root, 'navigation.ts') },
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: join(root, 'dist') },
    preview: { host: '127.0.0.1', port: 0 },
  };
  await build(config);
  server = await preview(config);
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const origin = server.resolvedUrls.local[0];
  await mkdir(join(project, '.local/product-sync/browser'), {
    recursive: true,
  });
  let renders = 0;
  const errors = [];
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript((mode) => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.classList.toggle('dark', mode === 'dark');
            document.documentElement.dataset.mode = mode;
            document.documentElement.dataset.theme = 'navy-gold';
          });
        }, mode);
        let saved = null;
        await page.route('**/api/**', async (route) => {
          const req = route.request(),
            url = new URL(req.url());
          let body = {};
          if (url.pathname === '/api/ai/products') body = { items: [product] };
          else if (
            url.pathname === `/api/ai/products/${id}` &&
            req.method() === 'PATCH'
          ) {
            saved = req.postDataJSON();
            body = { id };
          } else if (url.pathname.endsWith('/sources'))
            body = {
              links: [
                {
                  relationship: 'price',
                  notes: 'Pending column confirmation',
                  source: {
                    id: 'source',
                    source: 'fixture.csv',
                    source_row: 45,
                    record_key: 'fixture.csv:45',
                    kind: 'price',
                    data: { item_en: 'Archive price' },
                    review_status: 'pending',
                  },
                },
              ],
            };
          else if (url.pathname === '/api/ai/catalog-questions')
            body = {
              questions: [
                {
                  id: 'question',
                  product_id: id,
                  question: 'Which price column is approved?',
                  answer: '',
                  evidence: '',
                  confirmed_by: '',
                  confirmed_on: null,
                  status: 'open',
                  findings: [
                    {
                      id: 'finding',
                      source_record_id: 'source',
                      coverage: 'partial',
                      finding:
                        'Archive has O390 and P350; neither column is confirmed.',
                      remaining_question:
                        'Confirm authorised column and current validity.',
                      source: { record_key: 'fixture.csv:45' },
                    },
                  ],
                },
              ],
            };
          else if (url.pathname.endsWith('/guide'))
            body = { guide: null, owner: null, inherited: false };
          else if (url.pathname === '/api/quotation-knowledge')
            body = { records: [], total: 0, canReview: true };
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        });
        await page.goto(`${origin}?locale=${locale}&product=${id}`);
        await page.locator('#product-name').waitFor();
        assert.equal(
          await page.locator('#inventory-sku').inputValue(),
          'TEST-01'
        );
        await page.locator('#inventory-sku').fill('TEST-02');
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'حفظ التعديلات' : 'Save changes',
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () => document.querySelector('#inventory-sku')?.value === 'TEST-02'
        );
        for (let i = 0; i < 20 && !saved; i++) await page.waitForTimeout(50);
        assert.equal(saved?.sku, 'TEST-02');
        assert.equal(saved?.customer_visible, true);
        await page
          .getByRole('heading', {
            name:
              locale === 'ar'
                ? 'مصادر المنتج والتسعير والمكونات'
                : 'Linked product, pricing and component sources',
          })
          .waitFor();
        assert.ok(
          (await page.getByText('Pending column confirmation').count()) > 0
        );
        await page.screenshot({
          path: join(
            project,
            `.local/product-sync/browser/inventory-${locale}-${mode}-${width}.png`
          ),
          fullPage: true,
        });
        await page
          .getByRole('button', {
            name:
              locale === 'ar'
                ? 'الأسئلة المفتوحة والنتائج'
                : 'Open questions & findings',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', { name: /Which price column is approved/ })
          .click();
        await page
          .getByText('Archive has O390 and P350; neither column is confirmed.')
          .waitFor();
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute('aria-label')
          ),
          locale === 'ar' ? 'السؤال والنتائج' : 'Question and findings'
        );
        assert.equal(await page.locator('#cq-answer').inputValue(), '');
        assert.equal(await page.locator('#cq-status').inputValue(), 'open');
        assert.ok(
          await page
            .getByText(/Confirm authorised column and current validity/)
            .count()
        );
        await page.screenshot({
          path: join(
            project,
            `.local/product-sync/browser/findings-${locale}-${mode}-${width}.png`
          ),
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          'Screen overflows viewport'
        );
        renders += 2;
        await page.close();
      }
  assert.deepEqual(errors, []);
  console.log(
    `${renders} shared inventory/findings renders passed; edits preserve pending answers.`
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await rm(root, { recursive: true, force: true });
}
