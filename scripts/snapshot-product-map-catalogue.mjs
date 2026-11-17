/** Read-only live catalogue snapshot through the actual quotation loader. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const original = JSON.parse(fs.readFileSync('.local/product-map/before.json'));
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: { alias: { '@': path.resolve('src') } },
  server: { middlewareMode: true },
  logLevel: 'error',
});
try {
  const { loadQuotationCatalogue } = await vite.ssrLoadModule(
    '/src/lib/quotations/catalogue-server.ts'
  );
  const { productProfile, sellableCatalogue } = await vite.ssrLoadModule(
    '/src/lib/quotations/product-profile.ts'
  );
  const items = await loadQuotationCatalogue(db, original.accountId);
  assert.ok(!items.some((p) => p.inventory_type === 'component'));
  const products = sellableCatalogue(items).filter(
    (p) => p.inventory_type === 'product'
  );
  assert.equal(products.length, 30);
  for (const p of products) {
    const fields = productProfile(p).fields;
    assert.equal(
      new Set(fields.map((f) => f.key)).size,
      fields.length,
      `Duplicate choice for ${p.name}`
    );
    assert.ok(
      fields.some((f) => f.key === 'usedFor'),
      `Missing use question for ${p.name}`
    );
  }
  for (const size of [41, 55])
    assert.deepEqual(
      productProfile(
        products.find((p) => p.name === `Window Shutter ${size}`)
      ).fields.find((f) => f.key === 'finish').options,
      ['Beige', 'White']
    );
  assert.equal(
    productProfile(
      products.find((p) => p.name === 'Window Shutter 77')
    ).fields.find((f) => f.key === 'finish').options,
    undefined
  );
  fs.writeFileSync(
    '.local/product-map/catalogue-live.json',
    JSON.stringify({ items }, null, 2),
    { mode: 0o600 }
  );
  console.log(
    JSON.stringify({
      products: products.length,
      internalComponents: 0,
      items: items.length,
      allChoiceKeysUnique: true,
    })
  );
} finally {
  await vite.close();
}
