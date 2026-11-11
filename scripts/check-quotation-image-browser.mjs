/** Real workspace + document rendering with synthetic customers and intercepted writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createServer, build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = process.cwd(),
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'quotation-picture-'))
  ),
  evidence = path.join(project, '.local/quotation-image/browser');
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
  const ws = await ssr.ssrLoadModule('/src/lib/quotations/workspace.ts');
  const htmlModule = await ssr.ssrLoadModule(
    '/src/lib/quotations/build-html.ts'
  );
  const { normalizeReferenceImage } = await ssr.ssrLoadModule(
    '/src/lib/quotations/reference-image-server.ts'
  );
  const { renderHtmlToPdf } = await ssr.ssrLoadModule(
    '/src/lib/quotations/render.ts'
  );
  const { default: sharp } = await import('sharp');
  const landscape = await sharp({
    create: { width: 1600, height: 800, channels: 3, background: '#496e78' },
  })
    .png()
    .toBuffer();
  const portrait = await sharp({
    create: { width: 800, height: 1600, channels: 3, background: '#966a43' },
  })
    .webp()
    .toBuffer();
  const imageBytes = new Map();
  const initialBase = {
    id: ids.quote,
    accountId: ids.account,
    reference: 'HT-26-WS-901',
    revision: 0,
    status: 'draft',
    currency: 'QAR',
    clientName: 'Sample Customer',
    clientPhone: '+97450000000',
    clientCompany: 'Sample Villa',
    location: 'Doha',
    projectName: 'Villa renovation',
    subject: 'Supply and installation',
    validUntil: '2027-12-15',
    contactId: null,
    dealId: null,
    assignedTo: null,
    discountType: null,
    discountValue: null,
    subtotal: 100,
    discountAmount: 0,
    total: 100,
    pdfStoragePath: null,
    createdAt: '2026-11-11T10:00:00Z',
    workspaceVersion: 1,
    deliveryTerms: '15 days from advance payment',
    paymentTerms: '',
    warrantyTerms: 'One year',
    documentDetails: {
      formatVersion: 2,
      paymentPlan: { stages: [{ percent: 100, event: 'acceptance' }] },
      included: 'Supply and installation',
      excluded: 'Civil works',
    },
    items: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        quotationId: ids.quote,
        parentItemId: null,
        productId: null,
        position: 0,
        itemType: 'line',
        kind: null,
        itemCode: 'WS-01',
        description: 'Window shutter',
        descriptionAr: 'شتر نافذة',
        sizeW: null,
        sizeH: null,
        qty: 1,
        unitPrice: 100,
        discountType: null,
        discountValue: null,
        lineTotal: 100,
        unit: 'piece',
      },
    ],
  };
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1440]) {
        const messages = JSON.parse(
          await fs.readFile(
            path.join(project, `messages/${locale}.json`),
            'utf8'
          )
        ).QuotationWorkspace;
        let current = structuredClone(initialBase),
          uploadFail = false,
          uploadGate = null,
          saveConflict = false,
          documents = [],
          generated = [];
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
        });
        page.setDefaultTimeout(15000);
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
            url = new URL(req.url()),
            pathname = url.pathname;
          let body;
          try {
            body = req.postDataJSON();
          } catch {}
          let result = {},
            status = 200;
          if (pathname === '/api/fixture') result = current;
          else if (pathname.endsWith('/catalogue')) result = { items: [] };
          else if (pathname.endsWith('/image')) {
            if (req.method() === 'GET') {
              const bytes = imageBytes.get(url.searchParams.get('path'));
              await route.fulfill({
                status: bytes ? 200 : 404,
                contentType: 'image/jpeg',
                body: bytes || '',
              });
              return;
            }
            if (uploadGate) await uploadGate;
            if (uploadFail) {
              status = 503;
              result = { error: 'referenceImageUploadFailed' };
            } else {
              const { data, ...meta } = await normalizeReferenceImage(
                req.postDataBuffer()
              );
              const image = {
                ...meta,
                storagePath: `${ids.quote}/${crypto.randomUUID()}.jpg`,
              };
              imageBytes.set(image.storagePath, data);
              result = { image };
              status = 201;
            }
          } else if (pathname.endsWith('/preview')) {
            const q = ws.draftQuotation(current, body.draft),
              image = q.documentDetails.referenceImage;
            result = {
              html: htmlModule.buildQuotationHtml(
                q,
                q.items,
                image
                  ? `data:image/jpeg;base64,${imageBytes.get(image.storagePath).toString('base64')}`
                  : undefined
              ),
            };
          } else if (pathname.endsWith('/workspace')) {
            if (saveConflict) {
              status = 409;
              result = { error: 'conflict' };
            } else {
              const invalid = ws.validateDraft(body.draft);
              assert.equal(invalid, null);
              current = {
                ...ws.draftQuotation(current, body.draft),
                status: 'draft',
                revision: current.revision + (body.revise ? 1 : 0),
                workspaceVersion: current.workspaceVersion + 1,
              };
              result = current;
            }
          } else if (pathname.endsWith('/documents')) {
            if (req.method() === 'GET') result = documents;
            else {
              assert.equal(body.version, current.workspaceVersion);
              const image = current.documentDetails.referenceImage;
              const html = htmlModule.buildQuotationHtml(
                current,
                current.items,
                image
                  ? `data:image/jpeg;base64,${imageBytes.get(image.storagePath).toString('base64')}`
                  : undefined
              );
              const pdf = await renderHtmlToPdf(html);
              const documentId = crypto.randomUUID();
              const storagePath = `${ids.quote}/${documentId}.pdf`;
              generated.push({ snapshot: structuredClone(current), pdf });
              documents.unshift({
                id: documentId,
                revision: current.revision,
                workspace_version: current.workspaceVersion,
                storage_path: storagePath,
                created_at: new Date().toISOString(),
                sent_at: null,
              });
              result = {
                documentId,
                storagePath,
                revision: current.revision,
                publicUrl: '/fixture.pdf',
              };
              await fs.writeFile(
                path.join(
                  evidence,
                  `${locale}-${mode}-${width}-${image ? (image.height > image.width ? 'portrait' : 'landscape') : 'no-image'}.pdf`
                ),
                pdf
              );
            }
          } else if (pathname.endsWith('/followup'))
            result = { version: 0, reason: '', followUpDate: null };
          await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(result),
          });
        });
        await page.goto(server.resolvedUrls.local[0]);
        const field = page.locator('.qw-reference-image'),
          input = field.locator('input[type=file]');
        await field.waitFor({ state: 'visible' });
        assert.equal(await field.locator('img').count(), 0);
        // A held upload must block save/PDF, including the interval after upload progress reaches 100%.
        let release;
        uploadGate = new Promise((resolve) => {
          release = resolve;
        });
        await input.setInputFiles({
          name: 'landscape.png',
          mimeType: 'image/png',
          buffer: landscape,
        });
        await field.locator('[role=status]').waitFor();
        assert.equal(
          await page
            .getByRole('button', {
              name: messages.prepareWhatsApp,
              exact: true,
            })
            .first()
            .isDisabled(),
          true
        );
        assert.equal(
          await page
            .getByRole('button', { name: messages.saveDraft, exact: true })
            .first()
            .isDisabled(),
          true
        );
        release();
        uploadGate = null;
        await field.locator('img').waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector('.qw-reference-image img')?.naturalWidth > 0
        );
        await page
          .getByRole('button', { name: messages.saveDraft, exact: true })
          .first()
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector('.qw-save-state')?.dataset.state === 'saved'
        );
        assert.ok(current.documentDetails.referenceImage);
        const first = structuredClone(current.documentDetails.referenceImage);
        await page.reload();
        await field.waitFor({ state: 'visible' });
        await field.locator('img').waitFor();
        // Failed replacement keeps the saved picture and supports retry.
        uploadFail = true;
        await input.setInputFiles({
          name: 'portrait.webp',
          mimeType: 'image/webp',
          buffer: portrait,
        });
        await field.getByRole('alert').waitFor();
        assert.ok(
          (await field.locator('img').getAttribute('src')).includes(
            encodeURIComponent(first.storagePath)
          )
        );
        uploadFail = false;
        await field
          .getByRole('button', {
            name: messages.referenceImageRetry,
            exact: true,
          })
          .click();
        await page.waitForFunction(
          (firstPath) =>
            !document
              .querySelector('.qw-reference-image img')
              ?.getAttribute('src')
              ?.includes(encodeURIComponent(firstPath)),
          first.storagePath
        );
        // Conflict never replaces the persisted baseline; retry saves the local picture.
        saveConflict = true;
        await page
          .getByRole('button', { name: messages.saveDraft, exact: true })
          .first()
          .click();
        await page
          .getByRole('alert')
          .filter({ hasText: messages.conflict })
          .waitFor();
        assert.deepEqual(current.documentDetails.referenceImage, first);
        saveConflict = false;
        await page
          .getByRole('button', { name: messages.saveDraft, exact: true })
          .first()
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector('.qw-save-state')?.dataset.state === 'saved'
        );
        assert.ok(
          current.documentDetails.referenceImage.height >
            current.documentDetails.referenceImage.width
        );
        // Preview uses the embedded picture; actual renderer creates a PDF with no network fetch.
        await page
          .getByRole('button', { name: messages.reviewDocument, exact: true })
          .first()
          .click();
        const preview = page.frameLocator('iframe');
        await preview.locator('.reference-image img').waitFor();
        assert.equal(
          await preview
            .locator('.reference-image img')
            .evaluate((img) => img.naturalWidth > 0),
          true
        );
        const bounds = await preview
          .locator('.reference-image img')
          .boundingBox();
        assert.ok(bounds.width > 0 && bounds.height > bounds.width);
        await page.screenshot({
          path: path.join(evidence, `${locale}-${mode}-${width}-preview.png`),
          fullPage: true,
        });
        await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().endsWith('/documents') && r.request().method() === 'POST'
          ),
          page
            .getByRole('button', { name: messages.downloadPdf, exact: true })
            .click(),
        ]);
        await page.waitForFunction(
          () =>
            document.querySelector('.qw-save-state')?.dataset.state === 'saved'
        );
        await page
          .getByRole('button', { name: messages.closeReview, exact: true })
          .click();
        assert.equal(generated.length, 1);
        assert.ok(generated[0].snapshot.documentDetails.referenceImage);
        const oldPdf = Buffer.from(generated[0].pdf);
        await field
          .getByRole('button', { name: messages.remove, exact: true })
          .click();
        assert.equal(await field.locator('img').count(), 0);
        await page
          .getByRole('button', { name: messages.saveDraft, exact: true })
          .first()
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector('.qw-save-state')?.dataset.state === 'saved'
        );
        assert.equal(current.documentDetails.referenceImage, undefined);
        assert.deepEqual(generated[0].pdf, oldPdf);
        await page.reload();
        await field.waitFor({ state: 'visible' });
        assert.equal(await field.locator('img').count(), 0);
        await page
          .getByRole('button', { name: messages.reviewDocument, exact: true })
          .first()
          .click();
        await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().endsWith('/documents') && r.request().method() === 'POST'
          ),
          page
            .getByRole('button', { name: messages.downloadPdf, exact: true })
            .click(),
        ]);
        await page.waitForFunction(
          () =>
            document.querySelector('.qw-save-state')?.dataset.state === 'saved'
        );
        await page
          .getByRole('button', { name: messages.closeReview, exact: true })
          .click();
        assert.equal(generated.length, 2);
        assert.equal(
          generated[1].snapshot.documentDetails.referenceImage,
          undefined
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1
          ),
          false
        );
        await page.screenshot({
          path: path.join(evidence, `${locale}-${mode}-${width}-editor.png`),
          fullPage: true,
        });
        await page.close();
        cases++;
        console.log('Passed quotation picture journey', locale, mode, width);
      }
  // Render and inspect actual portrait/landscape bounds outside the scaled preview.
  for (const [name, bytes] of [
    ['landscape', landscape],
    ['portrait', portrait],
  ]) {
    const { data, ...meta } = await normalizeReferenceImage(bytes),
      q = structuredClone(initialBase);
    q.documentDetails.referenceImage = {
      ...meta,
      storagePath: `${ids.quote}/${crypto.randomUUID()}.jpg`,
    };
    const html = htmlModule.buildQuotationHtml(
      q,
      q.items,
      `data:image/jpeg;base64,${data.toString('base64')}`
    );
    const page = await browser.newPage();
    await page.setContent(html);
    await page.emulateMedia({ media: 'print' });
    const metrics = await page
      .locator('.reference-image img')
      .evaluate((img) => ({
        w: img.getBoundingClientRect().width,
        h: img.getBoundingClientRect().height,
        parent: img.parentElement.getBoundingClientRect().width,
        nw: img.naturalWidth,
        nh: img.naturalHeight,
      }));
    assert.ok(metrics.h <= 360 && metrics.w <= metrics.parent + 1);
    assert.ok(
      Math.abs(metrics.w / metrics.h - meta.width / meta.height) < 0.01
    );
    await page
      .locator('.reference-image')
      .screenshot({ path: path.join(evidence, `${name}-print.png`) });
    await fs.writeFile(
      path.join(evidence, `${name}.pdf`),
      await renderHtmlToPdf(html)
    );
    await page.close();
  }
  assert.deepEqual(failures, []);
  console.log(
    `Passed ${cases} full quotation picture journeys and portrait/landscape PDF checks.`
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await ssr?.close();
  await fs.rm(root, { recursive: true, force: true });
}
