/** Both real creation entry points; API writes are intercepted. Configuration/save/document journeys live in check-quotation-redesign-browser.mjs. */
import {
  mkdtemp,
  realpath,
  symlink,
  writeFile,
  readFile,
  rm,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { build, preview, createServer } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = process.cwd(),
  root = await realpath(await mkdtemp(join(tmpdir(), 'quotation-entry-'))),
  arg = process.argv.indexOf('--catalogue');
const data =
  arg >= 0
    ? JSON.parse(await readFile(process.argv[arg + 1], 'utf8'))
    : {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Motorized Window Shutters',
            name_ar: 'شتر نوافذ آلي',
            description: 'External aluminium window shutter.',
            specifications: 'Standard colours: white and beige.',
            kind: 'variant',
            parent_id: null,
            inventory_type: 'product',
            sku: 'WS-MOTOR',
            productCode: 'WS',
            familyName: 'Window Shutters',
            unit_of_measure: 'm2',
            price_min: 350,
            price_max: 380,
            price_unit: 'per_square_meter',
            customer_visible: true,
            aliases: [],
            sources: [],
          },
        ],
      };
const selectedProduct =
  data.items.find((p) => p.name === 'Motorized Window Shutters') ??
  data.items.find((p) => p.productCode === 'WS' && p.kind !== 'family');
assert.ok(selectedProduct);
let server, browser, ssr;
const errors = [];
let count = 0;
const evidence = join(project, '.local/quotation-redesign/entry-points');
try {
  await mkdir(evidence, { recursive: true });
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<style>html{--font-sans:Arial;--font-arabic:Arial}body{margin:0}</style><div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.ts'),
    "export function useAuth(){return {accountId:'fixture-account',accountRole:'owner',profileLoading:false}}"
  );
  await writeFile(
    join(root, 'can.ts'),
    'export function useCan(){return true}'
  );
  await writeFile(
    join(root, 'link.tsx'),
    'export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}'
  );
  await writeFile(
    join(root, 'main.tsx'),
    `import React from'react';import{createRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{QuotationList}from${JSON.stringify(join(project, 'src/components/quotations/quotation-list.tsx'))};import{QuotationsDialog}from${JSON.stringify(join(project, 'src/components/pipelines/quotations-dialog.tsx'))};import en from${JSON.stringify(join(project, 'messages/en.json'))};import ar from${JSON.stringify(join(project, 'messages/ar.json'))};import${JSON.stringify(join(project, 'src/app/globals.css'))};const locale=localStorage.getItem('fixtureLocale')||'en',mode=localStorage.getItem('fixtureMode')||'light';document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.dataset.mode=mode;document.documentElement.dataset.theme='navy-gold';document.documentElement.classList.toggle('dark',mode==='dark');createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><main style={{padding:24}}>{location.pathname.startsWith('/quotations/')?<p>Created quotation fixture</p>:location.search.includes('deal=true')?<QuotationsDialog open onOpenChange={()=>{}} dealId="33333333-3333-4333-8333-333333333333" contactId="44444444-4444-4444-8444-444444444444"/>:<QuotationList/>}</main></NextIntlClientProvider>);`
  );
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: 'next/link', replacement: join(root, 'link.tsx') },
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        { find: '@/hooks/use-can', replacement: join(root, 'can.ts') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: join(root, 'dist') },
    preview: { host: '127.0.0.1', port: 0 },
  };
  await build(config);
  server = await preview(config);
  ssr = await createServer({
    configFile: false,
    root: project,
    resolve: { alias: { '@': join(project, 'src') } },
    server: { middlewareMode: true },
    logLevel: 'error',
  });
  const core = await ssr.ssrLoadModule('/src/lib/quotations/catalogue.ts'),
    ws = await ssr.ssrLoadModule('/src/lib/quotations/workspace.ts'),
    profile = await ssr.ssrLoadModule('/src/lib/quotations/product-profile.ts');
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  for (const entry of ['list', 'deal'])
    for (const locale of ['en', 'ar'])
      for (const mode of ['light', 'dark'])
        for (const width of [390, 1440]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
          });
          page.on('pageerror', (e) => errors.push(e.message));
          await page.addInitScript(
            ({ locale, mode }) => {
              localStorage.setItem('fixtureLocale', locale);
              localStorage.setItem('fixtureMode', mode);
            },
            { locale, mode }
          );
          let posted, created;
          await page.route('**/api/**', async (route) => {
            const req = route.request(),
              p = new URL(req.url()).pathname;
            let result = [];
            if (p === '/api/quotations/catalogue') result = data;
            else if (p === '/api/quotation-product-codes')
              result = [
                ...new Set([
                  'D',
                  'WS',
                  ...data.items.map((p) => p.productCode).filter(Boolean),
                ]),
              ].map((code) => ({ code, label: code }));
            else if (p === '/api/quotations' && req.method() === 'POST') {
              posted = req.postDataJSON();
              const p = data.items.find(
                  (p) => p.id === posted.catalogueSelection.productId
                ),
                seed = core.catalogueItem(
                  p,
                  crypto.randomUUID(),
                  profile.productItemReference(p, [])
                ),
                terms = core.catalogueTerms(p);
              created = {
                id: 'fixture',
                accountId: '11111111-1111-4111-8111-111111111111',
                reference: 'HT-26-WS-001',
                revision: 0,
                status: 'draft',
                currency: 'QAR',
                clientName: 'Sample customer',
                clientPhone: null,
                clientCompany: null,
                location: null,
                projectName: null,
                subject: p.name,
                validUntil: null,
                contactId: posted.contactId ?? null,
                dealId: posted.dealId ?? null,
                assignedTo: null,
                discountType: null,
                discountValue: null,
                subtotal: 0,
                discountAmount: 0,
                total: 0,
                pdfStoragePath: null,
                createdAt: '2026-11-02T00:00:00Z',
                items: [],
                deliveryTerms: terms.deliveryTerms,
                paymentTerms: terms.paymentTerms,
                warrantyTerms: terms.warrantyTerms,
                documentDetails: {
                  formatVersion: 2,
                  catalogueSeed: seed,
                  ...(terms.paymentPlan
                    ? { paymentPlan: terms.paymentPlan }
                    : {}),
                },
              };
              result = created;
            }
            await route.fulfill({
              status:
                req.method() === 'POST' && p === '/api/quotations' ? 201 : 200,
              contentType: 'application/json',
              body: JSON.stringify(result),
            });
          });
          const messages = JSON.parse(
            await readFile(join(project, `messages/${locale}.json`), 'utf8')
          );
          await page.goto(
            server.resolvedUrls.local[0] +
              (entry === 'deal' ? '?deal=true' : '')
          );
          await page
            .getByRole('button', {
              name:
                entry === 'deal'
                  ? messages.Pipelines.quotationsDialog.newQuotation
                  : messages.Workspace.newQuotation,
              exact: true,
            })
            .click();
          const dialog = page.getByRole('dialog').last();
          await dialog
            .getByLabel(
              locale === 'ar' ? 'بحث في الكتالوج' : 'Search catalogue'
            )
            .fill(selectedProduct.sku ?? selectedProduct.name);
          await dialog
            .locator('.qp-catalogue-row')
            .filter({
              hasText:
                locale === 'ar' && selectedProduct.name_ar
                  ? selectedProduct.name_ar
                  : selectedProduct.name,
            })
            .first()
            .click();
          if (width === 1440)
            await page.screenshot({
              path: join(evidence, `${entry}-${locale}-${mode}.png`),
              fullPage: true,
            });
          await dialog
            .getByRole('button', {
              name:
                locale === 'ar' ? 'إضافة البند المحدد' : 'Add selected item',
              exact: true,
            })
            .click();
          await page.waitForURL('**/quotations/fixture');
          assert.equal(posted.productCode, 'WS');
          assert.equal(posted.catalogueSelection.productId, selectedProduct.id);
          assert.equal(posted.catalogueSelection.price, undefined);
          if (entry === 'deal') {
            assert.equal(posted.dealId, '33333333-3333-4333-8333-333333333333');
            assert.equal(
              posted.contactId,
              '44444444-4444-4444-8444-444444444444'
            );
          }
          const draft = ws.draftFromQuotation(created);
          assert.equal(draft.items[0].itemCode, 'WS01');
          assert.equal(draft.items[0].unit, 'm2');
          assert.equal(draft.items[0].unitPrice, undefined);
          assert.equal(ws.validateDraft(draft), null);
          await page.close();
          count++;
        }
  assert.deepEqual(errors, []);
  console.log(
    `${count} creation entry-point journeys passed: standalone and deal, English/Arabic, light/dark, mobile/desktop. Product-derived reference/unit preserved; no rate guessed and no live writes.`
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await ssr?.close();
  await rm(root, { recursive: true, force: true });
}
