/** Exercise the real creation and item-editor components. Synthetic catalogue by
 * default; a private --catalogue JSON can supply actual read-only catalogue data.
 * API writes are intercepted; no quotation or customer message is created. */
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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview, createServer } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = resolve(fileURLToPath(new URL('..', import.meta.url))),
  root = await realpath(await mkdtemp(join(tmpdir(), 'quotation-create-')));
const sourceId = '22222222-2222-4222-8222-222222222222',
  productId = '11111111-1111-4111-8111-111111111111';
const price = {
  id: sourceId,
  batch_id: productId,
  record_key: 'fixture:45',
  kind: 'price',
  source: 'fixture.csv',
  source_row: 45,
  data: {
    item_en: 'RC 41 / 55 installed',
    unit: 'per m2',
    col_O: '390',
    col_P: '350',
  },
  review_status: 'approved',
  review_version: 1,
  reviewed_at: '2026-11-02T00:00:00Z',
  configuration: {},
  review_notes: null,
};
const synthetic = {
  items: [
    {
      id: productId,
      name: 'Aluminium Roller Window Shutters',
      name_ar: 'شتر النوافذ',
      description: 'Aluminium shutter',
      specifications: 'White or beige. External installation.',
      parent_id: null,
      kind: 'product',
      inventory_type: 'product',
      sku: 'WS',
      unit_of_measure: 'm2',
      price_min: 350,
      price_max: 380,
      price_unit: 'per_square_meter',
      customer_visible: true,
      aliases: [],
      productCode: 'WS',
      familyName: 'Window Shutters',
      sources: [
        price,
        {
          ...price,
          id: 'terms',
          kind: 'product',
          data: {
            standard_delivery: '10-20 days',
            standard_payment: '100% advance (villa) or 70/30',
            warranty: '1 year',
          },
        },
      ],
    },
  ],
};
const arg = process.argv.indexOf('--catalogue'),
  data =
    arg >= 0
      ? JSON.parse(await readFile(process.argv[arg + 1], 'utf8'))
      : synthetic;
const windowProduct =
  data.items.find(
    (p) =>
      p.kind !== 'family' &&
      p.productCode === 'WS' &&
      p.name === 'Aluminium Roller Window Shutters'
  ) ?? data.items.find((p) => p.kind !== 'family' && p.productCode === 'WS');
assert.ok(windowProduct);
let browser, server, ssr;
const evidence = join(project, '.local/quotation-creation/browser');
try {
  await mkdir(evidence, { recursive: true });
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
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
    'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}'
  );
  await writeFile(
    join(root, 'main.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {QuotationList} from ${JSON.stringify(join(project, 'src/components/quotations/quotation-list.tsx'))};import {QuotationsDialog} from ${JSON.stringify(join(project, 'src/components/pipelines/quotations-dialog.tsx'))};import {WorkspaceItems} from ${JSON.stringify(join(project, 'src/components/quotations/workspace-items.tsx'))};import {draftFromQuotation} from ${JSON.stringify(join(project, 'src/lib/quotations/workspace.ts'))};import {applyCatalogueCapture} from ${JSON.stringify(join(project, 'src/lib/quotations/catalogue.ts'))};import {computeQuotationTotals} from ${JSON.stringify(join(project, 'src/lib/quotations/totals.ts'))};import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};import ${JSON.stringify(join(project, 'src/app/globals.css'))};
const locale=localStorage.getItem('fixtureLocale')||'en';document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
function Editor(){const[d,set]=React.useState(null);React.useEffect(()=>{fetch('/api/quotations/fixture').then(r=>r.json()).then(q=>set(draftFromQuotation(q)))},[]);if(!d)return <p>Loading</p>;return <><WorkspaceItems items={d.items} onChange={items=>set(v=>({...v,items}))} currency="QAR" disabled={false} onCatalogueCapture={(k,t,id,reset)=>set(v=>applyCatalogueCapture(v,k,t,id,reset))}/><label>Delivery<input aria-label="Recorded delivery" value={d.deliveryTerms} onChange={e=>set({...d,deliveryTerms:e.target.value})}/></label><label>Payment<textarea aria-label="Recorded payment" value={d.paymentTerms} readOnly/></label><button onClick={()=>fetch('/api/quotations/fixture/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:d})}).then(r=>r.json()).then(x=>{document.querySelector('#saved').textContent=x.error||'Saved'})}>Save fixture</button><output id="saved"/><output id="draft" style={{display:'none'}}>{JSON.stringify(d)}</output><output id="total">{computeQuotationTotals(d.items).total}</output></>}
createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Europe/Berlin"><main className="mx-auto max-w-6xl p-4">{location.pathname.startsWith('/quotations/')?<Editor/>:location.search.includes('deal=true')?<QuotationsDialog open onOpenChange={()=>{}} dealId="33333333-3333-4333-8333-333333333333" contactId="44444444-4444-4444-8444-444444444444"/>:<QuotationList/>}</main></NextIntlClientProvider>);`
  );
  const alias = [
    { find: 'next/link', replacement: join(root, 'link.tsx') },
    { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
    { find: '@/hooks/use-can', replacement: join(root, 'can.ts') },
    { find: '@', replacement: join(project, 'src') },
  ];
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: { alias },
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
    workspace = await ssr.ssrLoadModule('/src/lib/quotations/workspace.ts');
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const origin = server.resolvedUrls.local[0],
    errors = [];
  let cases = 0;
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1440]) {
        const messages = JSON.parse(
          await readFile(join(project, `messages/${locale}.json`), 'utf8')
        );
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(
          ({ locale, mode }) => {
            localStorage.setItem('fixtureLocale', locale);
            document.addEventListener('DOMContentLoaded', () => {
              document.documentElement.classList.toggle(
                'dark',
                mode === 'dark'
              );
              document.documentElement.dataset.mode = mode;
              document.documentElement.dataset.theme = 'navy-gold';
              document.documentElement.style.setProperty(
                '--font-sans',
                'Arial'
              );
              document.documentElement.style.setProperty(
                '--font-arabic',
                'Arial'
              );
            });
          },
          { locale, mode }
        );
        let created, posted, saved;
        await page.route('**/api/**', async (route) => {
          const req = route.request(),
            u = new URL(req.url());
          let body = [];
          if (u.pathname === '/api/quotations/catalogue') body = data;
          else if (u.pathname === '/api/quotation-product-codes')
            body = [
              ...new Set([
                'WS',
                ...data.items.map((p) => p.productCode).filter(Boolean),
              ]),
            ].map((code) => ({ code, label: code }));
          else if (u.pathname.endsWith('/sources')) body = { links: [] };
          else if (
            u.pathname === '/api/quotations' &&
            req.method() === 'POST'
          ) {
            posted = req.postDataJSON();
            const selection = core.parseCatalogueSelection(
                posted.catalogueSelection
              ),
              p = data.items.find((p) => p.id === selection.productId);
            const seed = core.catalogueItem(
              p,
              crypto.randomUUID(),
              'D01',
              selection.price
            );
            const terms = core.catalogueTerms(p, selection.paymentOption);
            created = {
              id: 'fixture',
              accountId: productId,
              reference: 'HT-26-WS-001',
              revision: 0,
              status: 'draft',
              currency: 'QAR',
              clientName: 'Fixture',
              clientPhone: null,
              clientCompany: null,
              location: null,
              projectName: null,
              subject: p.name,
              validUntil: null,
              contactId: null,
              dealId: null,
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
                catalogueSeed: { item: seed.item },
                ...(seed.knowledge ? { knowledge: seed.knowledge } : {}),
              },
            };
            body = created;
          } else if (u.pathname === '/api/quotations/fixture') body = created;
          else if (u.pathname.endsWith('/workspace')) {
            saved = req.postDataJSON().draft;
            const error = workspace.validateDraft(saved);
            body = { error };
          }
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        });
        await page.goto(origin + (mode === 'dark' ? '?deal=true' : ''));
        await page
          .getByRole('button', {
            name:
              mode === 'dark'
                ? messages.Pipelines.quotationsDialog.newQuotation
                : messages.Workspace.newQuotation,
            exact: true,
          })
          .click();
        await page
          .getByLabel(locale === 'ar' ? 'بحث في الكتالوج' : 'Search catalogue')
          .fill(windowProduct.name);
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: new RegExp(
              locale === 'ar' && windowProduct.name_ar
                ? windowProduct.name_ar
                : windowProduct.name
            ),
          })
          .first()
          .click();
        const select = page.getByLabel(
          locale === 'ar' ? 'السعر المسجل في المصدر' : 'Recorded source price'
        );
        await select.waitFor();
        const rate = windowProduct.sources.find(
          (r) =>
            r.kind === 'price' &&
            r.data.col_O === '390' &&
            r.data.unit === 'per m2'
        );
        assert.ok(rate);
        await select.selectOption(`${rate.id}:O`);
        await page
          .getByLabel(
            locale === 'ar'
              ? 'خيار الدفع من الكتالوج'
              : 'Catalogue payment option'
          )
          .selectOption('0');
        await page.screenshot({
          path: join(evidence, `catalogue-${locale}-${mode}-${width}.png`),
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          'Catalogue overflows'
        );
        await page
          .getByRole('button', {
            name:
              locale === 'ar'
                ? 'استخدام المنتج المحدد'
                : 'Use selected product',
            exact: true,
          })
          .click();
        await page.waitForURL('**/quotations/fixture');
        await page.locator('#draft').waitFor({ state: 'attached' });
        assert.equal(posted.catalogueSelection.productId, windowProduct.id);
        assert.equal(posted.productCode, 'WS');
        if (mode === 'dark') {
          assert.equal(posted.dealId, '33333333-3333-4333-8333-333333333333');
          assert.equal(
            posted.contactId,
            '44444444-4444-4444-8444-444444444444'
          );
        }
        let draft = JSON.parse(await page.locator('#draft').textContent());
        assert.equal(draft.items[0].productId, windowProduct.id);
        assert.equal(draft.items[0].unitPrice, 390);
        assert.equal(draft.items[0].unit, 'm2');
        assert.ok(draft.paymentTerms.includes('100%'));
        assert.ok(draft.deliveryTerms);
        await page
          .getByLabel(messages.QuotationWorkspace.width, { exact: true })
          .fill('138');
        await page
          .getByLabel(messages.QuotationWorkspace.height, { exact: true })
          .fill('165');
        await page.waitForFunction(
          () => document.querySelector('#total')?.textContent === '888.03'
        );
        await page
          .getByRole('button', { name: 'Save fixture', exact: true })
          .click();
        await page.getByText('Saved', { exact: true }).waitFor();
        assert.equal(saved.items.length, 1);
        assert.equal(saved.documentDetails.catalogueSeed, undefined);
        assert.equal(
          saved.documentDetails.knowledge.manualOverrides[0].unitPrice,
          390
        );
        const equipment = data.items.find((p) => p.sku === 'HT-EQP-014');
        if (equipment) {
          await page
            .getByText(
              messages.QuotationWorkspace.accessoriesCount.replace(
                '{count}',
                '0'
              ),
              { exact: true }
            )
            .click();
          await page
            .getByRole('button', {
              name: messages.QuotationWorkspace.addIncluded,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name:
                locale === 'ar'
                  ? 'من الكتالوج المشترك'
                  : 'From shared catalogue',
              exact: true,
            })
            .click();
          await page
            .getByLabel(
              locale === 'ar' ? 'بحث في الكتالوج' : 'Search catalogue'
            )
            .fill(equipment.sku);
          await page
            .getByRole('dialog')
            .getByRole('button', { name: new RegExp(equipment.name) })
            .first()
            .click();
          await page
            .getByRole('button', {
              name:
                locale === 'ar'
                  ? 'استخدام المنتج المحدد'
                  : 'Use selected product',
              exact: true,
            })
            .click();
          draft = JSON.parse(await page.locator('#draft').textContent());
          const motor = draft.items.find((i) => i.productId === equipment.id);
          assert.ok(motor);
          assert.equal(motor.kind, 'Included');
          assert.equal(motor.parentItemId, draft.items[0].id);
          assert.equal(motor.unitPrice, undefined);
          assert.equal(await page.locator('#total').textContent(), '888.03');
        }

        await page.screenshot({
          path: join(evidence, `created-${locale}-${mode}-${width}.png`),
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          'Editor overflows'
        );
        cases++;
        await page.close();
      }
  assert.deepEqual(errors, []);
  console.log(
    `${cases} complete quotation creation journeys passed: shared catalogue → recorded price/payment choice → seeded item/specifications/terms → area total → valid saved draft. No live writes.`
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await ssr?.close();
  await rm(root, { recursive: true, force: true });
}
