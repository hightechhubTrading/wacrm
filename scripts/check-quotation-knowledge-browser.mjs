/** Render the real quotation knowledge components with synthetic account responses. */
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
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = await realpath(
  await mkdtemp(join(tmpdir(), 'quotation-knowledge-'))
);
let server, browser;
const record = {
  id: '11111111-1111-4111-8111-111111111111',
  batch_id: '22222222-2222-4222-8222-222222222222',
  record_key: 'fixture:2',
  kind: 'price',
  source: 'fixture.csv',
  source_row: 2,
  data: { item_en: 'Fixture approved shutter rate' },
  review_status: 'approved',
  review_version: 1,
  reviewed_at: '2026-11-02T00:00:00Z',
  configuration: {
    family: 'WS',
    catalogItemId: '11111111-1111-4111-8111-111111111111',
    pricing: { basis: 'area', rate: 390, currency: 'QAR', column: 'confirmed' },
  },
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
    join(root, 'main.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';import {QuotationKnowledgePanel} from ${JSON.stringify(join(project, 'src/components/quotations/knowledge/quotation-knowledge-panel.tsx'))};import {KnowledgeLibrary} from ${JSON.stringify(join(project, 'src/components/quotations/knowledge/knowledge-library.tsx'))};import {QuotationFollowup} from ${JSON.stringify(join(project, 'src/components/quotations/knowledge/quotation-followup.tsx'))};import ${JSON.stringify(join(project, 'src/app/globals.css'))};
const params=new URLSearchParams(location.search),locale=params.get('locale')||'en';document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.lang=locale;
function App(){const[d,set]=React.useState({items:[{id:'33333333-3333-4333-8333-333333333333',itemCode:'D01',itemType:'line',description:'Window shutter',productId:'11111111-1111-4111-8111-111111111111',sizeW:138,sizeH:165,measurementUnit:'cm',qty:1,unit:'m2'}],documentDetails:{}});return <NextIntlClientProvider locale={locale} messages={{}} timeZone="Europe/Berlin"><main className="mx-auto max-w-3xl p-4">{params.get('screen')==='library'?<KnowledgeLibrary/>:<><label>Fixture width<input aria-label="Fixture width" type="number" value={d.items[0].sizeW} onChange={e=>set({...d,items:d.items.map(i=>({...i,sizeW:Number(e.target.value)}))})}/></label><QuotationKnowledgePanel draft={d} onChange={set} disabled={params.get('locked')==='true'}/><QuotationFollowup quotationId="fixture"/><output id="draft">{JSON.stringify(d)}</output></>}</main></NextIntlClientProvider>};createRoot(document.getElementById('root')).render(<App/>);`
  );
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: 'next/link', replacement: join(root, 'link.tsx') },
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
  await mkdir(join(project, '.local/quotation-evidence'), { recursive: true });
  const errors = [];
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
        });
        await page.addInitScript((mode) => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.dataset.mode = mode;
            document.documentElement.dataset.theme = 'navy-gold';
            document.documentElement.classList.toggle('dark', mode === 'dark');
            document.documentElement.style.setProperty('--font-sans', 'Arial');
            document.documentElement.style.setProperty(
              '--font-arabic',
              'Arial'
            );
          });
        }, mode);
        page.on('pageerror', (e) => errors.push(e.message));
        let followed = false;
        await page.route('**/api/**', async (route) => {
          const url = new URL(route.request().url());
          let body = [];
          if (url.pathname === '/api/catalog-items')
            body = [
              {
                id: record.id,
                name: 'Fixture product',
                description: 'Current shared inventory specification',
                unit_of_measure: 'm2',
              },
            ];
          else if (url.pathname.endsWith('/followup')) {
            if (route.request().method() === 'PUT') {
              followed = true;
              body = { ok: true, version: 1 };
            } else body = { reason: '', follow_up_date: null, version: 0 };
          } else if (url.pathname.endsWith('/review')) body = { ok: true };
          else if (url.pathname.endsWith('/history'))
            body = [
              {
                ...record,
                id: 'job',
                kind: 'job',
                data: {
                  Client: 'Fixture customer',
                  'Quote ref(s)': 'HT-26-WS-001',
                },
              },
            ];
          else {
            const kind = url.searchParams.get('kind') || 'product';
            body = {
              records: [
                {
                  ...record,
                  kind,
                  configuration:
                    kind === 'product'
                      ? {
                          ...record.configuration,
                          commercial: {
                            deliveryTerms: '30 days after advance',
                            paymentTerms: '60/30/10',
                            warrantyTerms:
                              'Fixture model-specific motor warranty',
                            validityDays: 10,
                          },
                        }
                      : record.configuration,
                  data:
                    kind === 'client'
                      ? {
                          client_key: 'Fixture customer',
                          spelling_variants_seen: 'Fixture customer',
                        }
                      : kind === 'product'
                        ? {
                            product_en: 'Window shutter',
                            product_ar: 'شتر نافذة',
                            what_is_included: '55 mm confirmed fixture',
                          }
                        : record.data,
                },
              ],
              batches: [
                {
                  id: record.batch_id,
                  label: 'Fixture batch',
                  source_version: 'a'.repeat(64),
                },
              ],
              count: 1,
              canReview: true,
            };
          }
          await route.fulfill({ json: body });
        });
        await page.goto(origin + '?locale=' + locale);
        await page.locator('summary').first().click();
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'مواصفات المنتج' : 'Product preset',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'اختيار' : 'Select',
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('#draft').textContent).items[0]
              .specification === 'Current shared inventory specification'
        );

        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'سعر القائمة' : 'List price',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'اختيار' : 'Select',
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('#draft').textContent).items[0]
              .unitPrice === 390
        );
        await page.getByLabel('Fixture width').fill('140');
        await page
          .getByRole('alert')
          .filter({ hasText: locale === 'ar' ? 'تغيرت' : 'changed' })
          .waitFor();
        const override = page.getByRole('button', {
          name:
            locale === 'ar'
              ? 'استخدام السعر كتعديل يدوي'
              : 'Use current price as manual override',
        });
        assert.equal(await override.isDisabled(), true);
        await page
          .getByLabel(
            locale === 'ar'
              ? 'سبب تعديل السعر يدوياً'
              : 'Reason for manual price override'
          )
          .fill('Fixture approval');
        await override.click();
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('#draft').textContent)
              .documentDetails.knowledge.manualOverrides.length === 1
        );
        await page
          .getByText(
            locale === 'ar'
              ? 'تجربة قائمة قص شتر 55 مم وتقدير التكلفة'
              : '55 mm shutter cut-list pilot and cost estimate',
            { exact: true }
          )
          .click();
        await page
          .getByLabel(
            locale === 'ar'
              ? 'حساب أولي لهذا النظام'
              : 'Calculate draft quantities for this system'
          )
          .check();
        await page
          .getByText(
            locale === 'ar'
              ? 'تكاليف ناقصة؛ الربح غير متاح'
              : 'Costs incomplete; margin unavailable',
            { exact: false }
          )
          .waitFor();
        assert.equal(
          await page
            .getByText(
              locale === 'ar'
                ? 'هامش تقديري قبل خصم الطلب والمصاريف العامة'
                : 'Estimated margin before order discounts and overheads',
              { exact: false }
            )
            .count(),
          0
        );
        const download = page.waitForEvent('download');
        await page
          .getByRole('button', {
            name:
              locale === 'ar'
                ? 'تصدير قائمة القص الأولية'
                : 'Export draft cut list',
          })
          .click();
        assert.match((await download).suggestedFilename(), /shutter55/);
        await page
          .getByRole('button', {
            name:
              locale === 'ar'
                ? 'حفظ التقدير في مسودة العرض'
                : 'Keep estimate in quotation draft',
          })
          .click();
        await page.waitForFunction(
          () =>
            Object.keys(
              JSON.parse(document.querySelector('#draft').textContent)
                .documentDetails.knowledge.costEstimates
            ).length === 1
        );
        await page
          .getByText(
            locale === 'ar'
              ? 'متابعة العرض وسبب النتيجة'
              : 'Quotation follow-up and outcome reason',
            { exact: true }
          )
          .click();
        await page
          .getByLabel(
            locale === 'ar'
              ? 'سبب الخسارة أو التأجيل / ملاحظة متابعة'
              : 'Loss or postponement reason / follow-up note'
          )
          .fill('Postponed');
        await page
          .getByLabel(locale === 'ar' ? 'تاريخ المتابعة' : 'Follow-up date')
          .fill('2026-11-09');
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'حفظ المتابعة' : 'Save follow-up',
          })
          .click();
        await page
          .getByRole('status')
          .filter({ hasText: locale === 'ar' ? 'تم الحفظ' : 'Saved' })
          .waitFor();
        assert.ok(followed);
        // Only the table may scroll horizontally; the page remains bounded.
        await page
          .locator('#draft')
          .evaluate((e) => (e.style.display = 'none'));
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          'quotation panel overflows'
        );
        await page.screenshot({
          path: join(
            project,
            '.local/quotation-evidence',
            `panel-${locale}-${mode}-${width}.png`
          ),
          fullPage: true,
        });
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'مواصفات المنتج' : 'Product preset',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'اختيار' : 'Select',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name:
              locale === 'ar'
                ? 'تطبيق الشروط المعتمدة'
                : 'Apply approved terms',
          })
          .click();
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('#draft').textContent)
              .warrantyTerms === 'Fixture model-specific motor warranty'
        );
        await page.goto(origin + '?locale=' + locale + '&screen=library');
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'التفاصيل' : 'Details',
            exact: true,
          })
          .click();
        await page
          .getByLabel(locale === 'ar' ? 'حالة المراجعة' : 'Review status')
          .waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          'library overflows'
        );
        await page.screenshot({
          path: join(
            project,
            '.local/quotation-evidence',
            `library-${locale}-${mode}-${width}.png`
          ),
          fullPage: true,
        });
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'سجل العملاء' : 'Customer history',
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name: locale === 'ar' ? 'التفاصيل' : 'Details',
            exact: true,
          })
          .click();
        await page
          .getByText(
            locale === 'ar'
              ? 'دليل فاتورة؛ السداد غير مؤكد'
              : 'Invoice evidence; payment unconfirmed',
            { exact: true }
          )
          .waitFor();
        await page.close();
      }
  assert.deepEqual(errors, []);
  console.log(
    'Quotation knowledge browser passed: English/Arabic, light/dark, 390/1440px, price application, stale-price gate, reasoned manual override, draft BOM CSV, incomplete-margin gate, sales follow-up, source review and alias history. Screenshots: .local/quotation-evidence.'
  );
} finally {
  await browser?.close();
  await server?.httpServer?.close();
  await rm(root, { recursive: true, force: true });
}
