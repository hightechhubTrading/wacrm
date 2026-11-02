/** Real workspace + document rendering with synthetic customers and intercepted writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createServer, build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = process.cwd(),
  arg = process.argv.indexOf('--catalogue');
if (arg < 0)
  throw Error('Supply a private --catalogue JSON with account product data.');
const { items: catalogue } = JSON.parse(
    await fs.readFile(process.argv[arg + 1], 'utf8')
  ),
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'quotation-redesign-'))
  ),
  evidence = path.join(project, '.local/quotation-redesign/browser');
const ids = {
  account: '10000000-0000-4000-8000-000000000001',
  quote: '10000000-0000-4000-8000-000000000002',
};
let browser, server, ssr;
const failures = [];
let cases = 0;
try {
  await fs.mkdir(evidence, { recursive: true });
  await fs.symlink(
    path.join(project, 'node_modules'),
    path.join(root, 'node_modules')
  );
  const font = (
    await fs.readFile(
      path.join(
        project,
        'node_modules/@fontsource/tajawal/files/tajawal-arabic-400-normal.woff2'
      )
    )
  ).toString('base64');
  await fs.writeFile(
    path.join(root, 'index.html'),
    `<style>@font-face{font-family:FixtureArabic;src:url(data:font/woff2;base64,${font})}html{--font-sans:Arial;--font-arabic:FixtureArabic}body{margin:0}</style><div id="root"></div><script type="module" src="/main.tsx"></script>`
  );
  await fs.writeFile(
    path.join(root, 'link.tsx'),
    'export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}'
  );
  await fs.writeFile(
    path.join(root, 'supabase.ts'),
    `const result={data:[],error:null};export function createClient(){const chain=new Proxy({}, {get(_,k){if(k==='then')return Promise.resolve(result).then.bind(Promise.resolve(result));return ()=>chain}});return {from:()=>chain,storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'/fixture.pdf'}})})}}}`
  );
  await fs.writeFile(
    path.join(root, 'main.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {QuotationWorkspace} from ${JSON.stringify(path.join(project, 'src/components/quotations/quotation-workspace.tsx'))};import en from ${JSON.stringify(path.join(project, 'messages/en.json'))};import ar from ${JSON.stringify(path.join(project, 'messages/ar.json'))};import ${JSON.stringify(path.join(project, 'src/app/globals.css'))};const locale=localStorage.getItem('fixtureLocale')||'en';document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.dataset.mode=localStorage.getItem('fixtureMode')||'light';document.documentElement.dataset.theme='navy-gold';document.documentElement.classList.toggle('dark',localStorage.getItem('fixtureMode')==='dark');fetch('/api/fixture').then(r=>r.json()).then(initial=>createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><main style={{padding:16}}><QuotationWorkspace initial={initial}/></main></NextIntlClientProvider>));`
  );
  const alias = [
    { find: 'next/link', replacement: path.join(root, 'link.tsx') },
    {
      find: '@/lib/supabase/client',
      replacement: path.join(root, 'supabase.ts'),
    },
    { find: '@', replacement: path.join(project, 'src') },
  ];
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: { alias },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: path.join(root, 'dist') },
    preview: { host: '127.0.0.1', port: 0 },
  };
  await build(config);
  server = await preview(config);
  ssr = await createServer({
    configFile: false,
    root: project,
    resolve: { alias: { '@': path.join(project, 'src') } },
    server: { middlewareMode: true },
    logLevel: 'error',
  });
  const core = await ssr.ssrLoadModule('/src/lib/quotations/catalogue.ts'),
    ws = await ssr.ssrLoadModule('/src/lib/quotations/workspace.ts'),
    htmlModule = await ssr.ssrLoadModule('/src/lib/quotations/build-html.ts');
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const shutter = catalogue.find((p) => p.name === 'Motorized Window Shutters'),
    garage = catalogue.find(
      (p) => p.name === 'American-style Sectional Garage Door'
    ),
    delivery = catalogue.find((p) => p.sku === 'PL26-132'),
    motor = catalogue.find((p) => p.sku === 'HT-EQP-014');
  assert.ok(shutter && garage && delivery && motor);
  const scenarios = process.env.QUOTATION_QUICK
    ? ['shutter']
    : ['shutter', 'garage', 'mixed'];
  for (const scenario of scenarios)
    for (const locale of process.env.QUOTATION_ONE ? ['en'] : ['en', 'ar'])
      for (const mode of process.env.QUOTATION_ONE
        ? ['light']
        : ['light', 'dark'])
        for (const width of process.env.QUOTATION_ONE ? [1440] : [390, 1440]) {
          const initial = {
            id: ids.quote,
            accountId: ids.account,
            reference:
              scenario === 'garage'
                ? 'HT-26-SEC-902'
                : scenario === 'mixed'
                  ? 'HT-26-WS-903'
                  : 'HT-26-WS-901',
            revision: 0,
            status: 'draft',
            currency: 'QAR',
            clientName: 'Sample Customer',
            clientPhone: '+97450000000',
            clientCompany: 'Sample Villa Project',
            location: 'Doha',
            projectName: 'Villa renovation',
            subject: 'Supply and installation',
            validUntil: '2026-12-15',
            contactId: null,
            dealId: null,
            assignedTo: null,
            discountType: null,
            discountValue: null,
            subtotal: 0,
            discountAmount: 0,
            total: 0,
            pdfStoragePath: null,
            createdAt: '2026-11-02T10:00:00Z',
            workspaceVersion: 0,
            deliveryTerms: '10–15 days from advance payment.',
            paymentTerms: '',
            warrantyTerms: 'One year from installation.',
            documentDetails: {
              included: 'Supply and installation\nTesting and commissioning',
              excluded: 'Civil works\nElectrical supply',
            },
            items: [],
          };
          let saved = null;
          let previewRequests = 0;
          let current = initial;
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
          });
          page.setDefaultTimeout(12000);
          console.log('Checking', scenario, locale, mode, width);
          page.on('pageerror', (e) => failures.push(e.message));
          await page.addInitScript(
            ({ locale, mode }) => {
              if (window !== window.top) return;
              localStorage.setItem('fixtureLocale', locale);
              localStorage.setItem('fixtureMode', mode);
            },
            { locale, mode }
          );
          await page.route('**/api/**', async (route) => {
            const req = route.request(),
              pathname = new URL(req.url()).pathname;
            let body = null;
            try {
              body = req.postDataJSON();
            } catch {}
            let result = {},
              status = 200;
            if (pathname === '/api/fixture') result = initial;
            else if (pathname === '/api/quotations/catalogue')
              result = { items: catalogue };
            else if (pathname.endsWith('/preview')) {
              previewRequests++;
              const d = body.draft;
              result = {
                html: htmlModule.buildQuotationHtml(
                  ws.draftQuotation(current, d),
                  ws.draftQuotation(current, d).items
                ),
              };
            } else if (pathname.endsWith('/workspace')) {
              const error = ws.validateDraft(body.draft);
              if (error) {
                result = { error };
                status = 400;
              } else {
                saved = body.draft;
                current = {
                  ...ws.draftQuotation(current, saved),
                  workspaceVersion: (current.workspaceVersion ?? 0) + 1,
                };
                result = current;
              }
            } else if (pathname.endsWith('/documents')) result = [];
            else if (
              pathname.includes('/products/') &&
              pathname.endsWith('/sources')
            )
              result = { links: [] };
            else if (pathname.endsWith('/followup'))
              result = { version: 0, reason: '', followUpDate: null };
            else if (pathname === '/api/quotations/knowledge')
              result = { records: [], batches: [], count: 0, canReview: false };
            await route.fulfill({
              status,
              contentType: 'application/json',
              body: JSON.stringify(result),
            });
          });
          const messages = JSON.parse(
              await fs.readFile(
                path.join(project, `messages/${locale}.json`),
                'utf8'
              )
            ),
            t = messages.QuotationWorkspace,
            l = (en, a) => (locale === 'ar' ? a : en);
          await page.goto(server.resolvedUrls.local[0]);
          await page
            .getByRole('button', { name: new RegExp(t.productsServices) })
            .first()
            .click();
          async function add(p, type = 'product', equipment = false) {
            await page
              .getByRole('button', {
                name: equipment
                  ? l('Add equipment', 'إضافة معدات')
                  : l('Add item', 'إضافة بند'),
                exact: true,
              })
              .click();
            const dialog = page.getByRole('dialog');
            if (type !== (equipment ? 'equipment' : 'product'))
              await dialog
                .getByRole('button', {
                  name:
                    type === 'service'
                      ? l('Services', 'الخدمات')
                      : l('Products', 'المنتجات'),
                  exact: true,
                })
                .click();
            await dialog
              .getByLabel(l('Search catalogue', 'بحث في الكتالوج'))
              .fill(p.sku || p.name);
            await dialog
              .locator('.qp-catalogue-row')
              .filter({
                hasText: locale === 'ar' && p.name_ar ? p.name_ar : p.name,
              })
              .first()
              .click();
            if (equipment)
              await dialog
                .getByRole('button', {
                  name: l('Included in product price', 'مشمول في سعر المنتج'),
                  exact: true,
                })
                .click();
            await dialog
              .getByRole('button', {
                name: l('Add selected item', 'إضافة البند المحدد'),
                exact: true,
              })
              .click();
          }
          async function configure(p, w, h, amount) {
            await add(p);
            if (w) {
              await page.getByLabel(t.width, { exact: true }).fill(String(w));
              await page.getByLabel(t.height, { exact: true }).fill(String(h));
            }
            const rate = core
              .cataloguePriceRows(p)
              .find((r) => Number(r.data.col_O) === amount);
            assert.ok(rate, 'Missing exact source rate for ' + p.name);
            await page
              .getByLabel(l('Recorded selling rates', 'أسعار البيع المسجلة'), {
                exact: true,
              })
              .selectOption(rate.id + ':O');
            const finish = page.getByLabel(
              l('Colour / finish', 'اللون / التشطيب'),
              { exact: true }
            );
            if (await finish.count()) {
              if (await finish.evaluate((el) => el.tagName === 'SELECT'))
                await finish.selectOption('White');
              else await finish.fill('White');
            }
            await page
              .getByLabel(
                l('Drawing / opening reference', 'مرجع المخطط / الفتحة'),
                { exact: true }
              )
              .fill(p === shutter ? 'W-01' : 'G-01');
          }
          if (scenario === 'shutter' || scenario === 'mixed') {
            await configure(shutter, 138, 165, 390);
            await add(motor, 'equipment', true);
            await page.locator('.qp-equipment-row').waitFor();
          }
          if (scenario === 'garage' || scenario === 'mixed') {
            if (width < 640 && scenario === 'mixed')
              await page
                .getByRole('button', {
                  name: l('All items', 'كل البنود'),
                  exact: true,
                })
                .click();
            await configure(garage, 400, 300, 7320);
          }
          if (scenario === 'mixed') {
            if (width < 640)
              await page
                .getByRole('button', {
                  name: l('All items', 'كل البنود'),
                  exact: true,
                })
                .click();
            await add(delivery, 'service');
          }
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: path.join(
              evidence,
              `${scenario}-${locale}-${mode}-${width}-editor.png`
            ),
            fullPage: true,
          });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            'Workspace overflows'
          );
          await page
            .getByRole('button', { name: new RegExp(t.commercialTerms) })
            .first()
            .click();
          await page.locator('.qp-payment').waitFor({ state: 'visible' });
          const deliverySelect = page.getByLabel(t.deliveryTerms, {
            exact: true,
          });
          assert.equal(
            await deliverySelect.evaluate((e) => e.tagName),
            'SELECT'
          );
          assert.equal(
            await page
              .getByLabel(t.warrantyTerms, { exact: true })
              .evaluate((e) => e.tagName),
            'SELECT'
          );
          const deliveryField = deliverySelect.locator('..').locator('..');
          await deliveryField
            .getByRole('button', { name: l('Edit', 'تعديل'), exact: true })
            .click();
          const customDelivery = page.getByLabel(
            t.deliveryTerms + ' — ' + l('custom text', 'نص مخصص'),
            { exact: true }
          );
          await customDelivery.fill('8–10 days after site readiness');
          await deliveryField
            .getByRole('button', { name: l('Done', 'تم'), exact: true })
            .click();
          assert.equal(
            await deliverySelect.locator('option:checked').textContent(),
            '8–10 days after site readiness'
          );
          await page
            .getByLabel(l('Payment arrangement', 'ترتيب الدفع'), {
              exact: true,
            })
            .waitFor();
          const set = page.getByRole('button', {
            name: l('Set payment schedule', 'تحديد جدول الدفعات'),
            exact: true,
          });
          if (await set.count()) await set.click();
          const event = page.getByLabel(
            l('Payment event', 'موعد الدفع') + ' 1',
            { exact: true }
          );
          await event.selectOption('acceptance');
          await page
            .getByLabel(l('Percentage', 'النسبة') + ' 1', { exact: true })
            .selectOption('custom');
          const customShare = page.getByLabel(
            l('Percentage', 'النسبة') + ' 1' + l(' — custom', ' — مخصص'),
            { exact: true }
          );
          await customShare.fill('17.5');
          assert.equal(await customShare.inputValue(), '17.5');
          await page
            .getByLabel(l('Percentage', 'النسبة') + ' 1', { exact: true })
            .selectOption('100');
          if (scenario !== 'shutter') {
            await page
              .getByLabel(l('Percentage', 'النسبة') + ' 1', { exact: true })
              .selectOption(scenario === 'garage' ? '70' : '60');
            await page
              .getByRole('button', {
                name: l('+ Add instalment', '+ إضافة دفعة'),
                exact: true,
              })
              .click();
            await page
              .getByLabel(l('Payment event', 'موعد الدفع') + ' 2', {
                exact: true,
              })
              .selectOption(
                scenario === 'garage' ? 'before_installation' : 'delivery'
              );
            if (scenario === 'mixed') {
              await page
                .getByLabel(l('Percentage', 'النسبة') + ' 2', { exact: true })
                .selectOption('30');
              await page
                .getByRole('button', {
                  name: l('+ Add instalment', '+ إضافة دفعة'),
                  exact: true,
                })
                .click();
              await page
                .getByLabel(l('Payment event', 'موعد الدفع') + ' 3', {
                  exact: true,
                })
                .selectOption('completion');
            }
          }

          assert.equal(
            await page
              .getByRole('button', {
                name: l('+ Add instalment', '+ إضافة دفعة'),
                exact: true,
              })
              .isDisabled(),
            true
          );
          const firstShare = page.getByLabel(l('Percentage', 'النسبة') + ' 1', {
            exact: true,
          });
          if (scenario !== 'shutter') {
            assert.equal(
              await firstShare
                .locator('option[value="100"]')
                .evaluate((e) => e.disabled),
              true
            );
            await firstShare.selectOption('custom');
            const overflowShare = page.getByLabel(
              l('Percentage', 'النسبة') + ' 1' + l(' — custom', ' — مخصص'),
              { exact: true }
            );
            await overflowShare.fill('999');
            assert.equal(
              await overflowShare.inputValue(),
              scenario === 'garage' ? '70' : '60'
            );
          }

          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: path.join(
              evidence,
              `${scenario}-${locale}-${mode}-${width}-payments.png`
            ),
            fullPage: true,
          });
          await page
            .getByRole('button', { name: t.saveDraft, exact: true })
            .first()
            .click();
          await page.waitForFunction(
            (text) =>
              document
                .querySelector('.qw-save-state')
                ?.textContent?.includes(text),
            t.saved
          );
          assert.ok(saved, 'Workspace did not save');
          assert.equal(ws.validateDraft(saved, true), null);
          assert.equal(
            saved.documentDetails.paymentPlan.stages.length,
            scenario === 'shutter' ? 1 : scenario === 'garage' ? 2 : 3
          );
          assert.equal(
            saved.documentDetails.paymentPlan.stages[0].event,
            'acceptance'
          );
          assert.ok(
            saved.items[0].itemCode.startsWith(
              scenario === 'garage' ? 'SEC' : 'WS'
            )
          );
          const total =
            scenario === 'shutter'
              ? 888.03
              : scenario === 'garage'
                ? 7320
                : 8408.03;
          assert.equal(current.total, total);
          assert.equal(
            saved.items
              .filter((i) => i.kind === 'Included')
              .reduce((n, i) => n + (i.unitPrice ?? 0), 0),
            0
          );
          assert.equal(
            previewRequests,
            0,
            'Closed preview should not regenerate while editing'
          );
          await page
            .getByRole('button', { name: t.reviewDocument, exact: true })
            .first()
            .click();
          const review = page.getByRole('dialog');
          await review.locator('iframe').waitFor();
          await review
            .frameLocator('iframe')
            .locator('.doc-reference')
            .waitFor();
          assert.equal(
            await review
              .frameLocator('iframe')
              .locator('.doc-reference')
              .textContent(),
            current.reference
          );
          assert.ok(
            previewRequests > 0,
            'Opening preview must request the current draft'
          );
          await review
            .getByRole('button', { name: t.closeReview, exact: true })
            .click();
          assert.ok(
            await page.locator('.qw-editor').isVisible(),
            'Editor disappeared after closing preview'
          );
          const html = htmlModule.buildQuotationHtml(current, current.items);
          await fs.writeFile(
            path.join(evidence, `${scenario}-quote.json`),
            JSON.stringify(current)
          );
          assert.ok(!html.includes('in the source'));
          assert.ok(!html.includes('Recorded standard'));
          await fs.writeFile(path.join(evidence, `${scenario}.html`), html);
          if (locale === 'en' && mode === 'light' && width === 1440) {
            const doc = await browser.newPage({
              viewport: { width: 900, height: 1250 },
              javaScriptEnabled: false,
            });
            await doc.setContent(html);
            await doc.evaluate(() => document.fonts.ready);
            assert.ok(
              await doc
                .locator('.items tbody td:nth-child(2)')
                .first()
                .evaluate((el) => el.textContent.length < 300),
              'Long specifications leaked into commercial table'
            );
            await doc.screenshot({
              path: path.join(evidence, `${scenario}-document.png`),
              fullPage: true,
            });
            await doc.pdf({
              path: path.join(evidence, `${scenario}.pdf`),
              ...(
                await ssr.ssrLoadModule(
                  '/src/lib/quotations/document-layout.ts'
                )
              ).DOCUMENT_PDF_OPTIONS,
            });
            await doc.close();
          }
          await page.close();
          cases++;
        }
  assert.deepEqual(failures, []);
  console.log(
    `${cases} full workspace journeys passed: product selection, correct rate/unit, dimensions, included equipment, structured payments, saved snapshots and customer documents. No live writes.`
  );
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        await page.evaluate(() => scrollTo(0, 0));
        await page
          .screenshot({
            path: path.join(evidence, 'failure.png'),
            fullPage: true,
          })
          .catch(() => {});
        await fs.writeFile(
          path.join(evidence, 'failure.txt'),
          await page
            .locator('body')
            .innerText()
            .catch(() => '')
        );
      }
  throw error;
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await ssr?.close();
  await fs.rm(root, { recursive: true, force: true });
}
