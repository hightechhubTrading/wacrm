/** Real chat picker with the migrated inventory fixture; no sends or live writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const project = process.cwd(),
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'product-map-picker-'))
  ),
  dir = path.join(project, '.local/product-map/picker-browser');
const snapshot = JSON.parse(
  await fs.readFile('.local/product-map/followup-after.json', 'utf8')
);
const items = snapshot.products.map((p) => ({
  ...p,
  files: snapshot.media.filter((m) => m.product_id === p.id),
}));
let server, browser;
try {
  await fs.mkdir(dir, { recursive: true });
  await fs.symlink(
    path.join(project, 'node_modules'),
    path.join(root, 'node_modules')
  );
  await fs.writeFile(
    path.join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await fs.writeFile(
    path.join(root, 'supabase.ts'),
    `export const createClient=()=>({storage:{from:()=>({getPublicUrl:p=>({data:{publicUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'}})})}});`
  );
  await fs.writeFile(
    path.join(root, 'main.tsx'),
    `import React from 'react';import{createRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{CatalogPickerDialog}from${JSON.stringify(path.join(project, 'src/components/inbox/catalog-picker-dialog.tsx'))};import en from ${JSON.stringify(path.join(project, 'messages/en.json'))};import ar from ${JSON.stringify(path.join(project, 'messages/ar.json'))};import ${JSON.stringify(path.join(project, 'src/app/globals.css'))};const locale=localStorage.getItem('locale')||'en';document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.documentElement.classList.toggle('dark',localStorage.getItem('mode')==='dark');createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Europe/Berlin"><CatalogPickerDialog open onOpenChange={()=>{}} onPick={item=>window.picked=item}/></NextIntlClientProvider>);`
  );
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        {
          find: '@/lib/supabase/client',
          replacement: path.join(root, 'supabase.ts'),
        },
        { find: '@', replacement: path.join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: path.join(root, 'dist') },
    preview: { host: '127.0.0.1', port: 0 },
  };
  await build(config);
  server = await preview(config);
  const port = server.httpServer.address().port;
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  let cases = 0;
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(
          ({ locale, mode }) => {
            localStorage.setItem('locale', locale);
            localStorage.setItem('mode', mode);
          },
          { locale, mode }
        );
        await page.route('**/api/ai/products', (r) =>
          r.fulfill({ json: { items } })
        );
        await page.goto(`http://127.0.0.1:${port}`);
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        const categories = items.filter(
          (p) =>
            p.kind === 'family' &&
            p.inventory_type === 'product' &&
            p.status === 'approved' &&
            p.customer_visible &&
            !p.superseded_by
        );
        await dialog
          .getByRole('button', {
            name: new RegExp(
              locale === 'ar' ? 'شتر النوافذ' : 'Window Shutters'
            ),
          })
          .click();
        assert.equal(
          await dialog
            .getByRole('button', { name: /Window Shutter|شتر نوافذ/ })
            .count(),
          3
        );
        assert.equal(await dialog.getByText('D1', { exact: true }).count(), 0);
        await dialog
          .getByRole('button', {
            name: new RegExp(
              locale === 'ar' ? 'شتر نوافذ 55' : 'Window Shutter 55'
            ),
          })
          .click();
        assert.equal(
          await dialog
            .getByRole('button', {
              name: new RegExp(locale === 'ar' ? 'إضافة' : 'Add'),
            })
            .count(),
          0
        );
        await page.screenshot({
          path: path.join(dir, `window-${locale}-${mode}-${width}.png`),
        });
        await dialog
          .getByRole('button', { name: locale === 'ar' ? 'رجوع' : 'Back' })
          .click();
        await dialog
          .getByRole('button', { name: locale === 'ar' ? 'رجوع' : 'Back' })
          .click();
        const category = categories.find(
          (p) => p.name === 'Steel Doors and Gates'
        );
        await dialog
          .getByRole('button', {
            name: new RegExp(
              locale === 'ar' ? category.name_ar : category.name
            ),
          })
          .click();
        const swing = items.find(
          (p) => p.name === 'Swing' && p.status === 'approved'
        );
        await dialog
          .getByRole('button', {
            name: new RegExp(locale === 'ar' ? swing.name_ar : '^Swing'),
          })
          .click();
        await dialog.locator('li button').first().click();
        const picked = await page.evaluate(() => window.picked);
        assert.ok(swing.files.some((f) => f.storage_path === picked.path));
        assert.equal(picked.kind, 'image');
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        );
        assert.deepEqual(errors, []);
        await page.close();
        cases++;
      }
  console.log(
    `${cases} migrated-inventory chat picker journeys passed: category, exact products, no guessed shutter media, and staged Swing photo; no sends.`
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await fs.rm(root, { recursive: true, force: true });
}
