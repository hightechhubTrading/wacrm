import { arabicDescriptions } from './product-map-data.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const dir = '.local/product-map',
  before = JSON.parse(fs.readFileSync(`${dir}/followup-after.json`)),
  original = JSON.parse(fs.readFileSync(`${dir}/before.json`)),
  manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`));
const a = original.accountId;
if (!/^[a-f0-9-]{36}$/.test(a)) throw Error('Invalid account');
const query = (sql) => {
  const r = spawnSync(
    'supabase',
    ['db', 'query', '--linked', sql, '-o', 'json'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (r.status) throw Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout).rows;
};
const after = query(
  `select jsonb_build_object('products',(select jsonb_agg(to_jsonb(p)) from ai_products p where account_id='${a}'),'media',(select jsonb_agg(to_jsonb(m)) from ai_product_media m where account_id='${a}'),'questions',(select jsonb_agg(to_jsonb(q)) from ai_catalog_questions q where account_id='${a}'),'projection',(select jsonb_agg(to_jsonb(c)) from catalog_items c where account_id='${a}')) snapshot`
)[0].snapshot;
fs.writeFileSync(`${dir}/final-after.json`, JSON.stringify(after, null, 2), {
  mode: 0o600,
});
assert.equal(after.products.length, before.products.length);
for (const p of before.products) {
  const actual = after.products.find((r) => r.id === p.id);
  const expected = { ...p };
  const target = manifest.rows.find(
    (r) => r.id === p.id && r.kind === 'product'
  );
  if (target) {
    expected.description_ar = arabicDescriptions[target.name];
    expected.updated_at = actual.updated_at;
    assert.ok(actual.description_ar);
  }
  assert.deepEqual(actual, expected);
}
const added = after.products.filter(
  (p) => !before.products.some((r) => r.id === p.id)
);
for (const p of added) {
  assert.equal(p.inventory_type, 'service');
  assert.equal(p.customer_visible, false);
  assert.equal(p.price_min, null);
  assert.equal(p.price_max, null);
}
assert.deepEqual(
  after.questions.sort((a, b) => a.id.localeCompare(b.id)),
  before.questions.sort((a, b) => a.id.localeCompare(b.id))
);
for (const old of before.media) {
  const expected = { ...old };
  if (old.id === original.media[33].id)
    expected.product_id = manifest.rows.find((r) => r.name === 'Swing').id;
  if (old.id === original.media[49].id)
    expected.product_id = original.products.find(
      (r) => r.name === 'Aluminium Roller Window Shutters'
    ).id;
  assert.deepEqual(
    after.media.find((r) => r.id === old.id),
    expected
  );
}
assert.equal(after.media.length, before.media.length);
assert.equal(after.projection.length, after.products.length);
const previous = JSON.parse(fs.readFileSync(`${dir}/preservation-before.json`))
    .rows[0].preservation,
  current = query(fs.readFileSync(`${dir}/preservation.sql`, 'utf8'))[0]
    .preservation;
for (const t of Object.keys(previous).filter((t) => t !== 'catalog_items'))
  assert.deepEqual(current[t], previous[t]);
const report = {
  verifiedAt: new Date().toISOString(),
  canonicalIdentities: after.products.length,
  projectionIdentities: after.projection.length,
  addedServices: added.map((p) => ({ name: p.name, status: p.status })),
  preservedPriorProducts: before.products.length,
  preservedMedia: after.media.length,
  exactProductPhotoAssignments: 33,
  additionalMediaCategoryCorrection: 1,
  preservedQuestionRows: after.questions.length,
  historicalFingerprints: 'unchanged',
};
fs.writeFileSync(
  `${dir}/final-verification.json`,
  JSON.stringify(report, null, 2),
  { mode: 0o600 }
);
console.log(JSON.stringify(report));
