/** Independently inspect the live map and compare preserved account history. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = '.local/product-map';
const before = JSON.parse(fs.readFileSync(`${dir}/before.json`));
const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`));
const query = (sql) => {
  const r = spawnSync(
    'supabase',
    ['db', 'query', '--linked', sql, '-o', 'json'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (r.status) throw Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout).rows;
};
const a = before.accountId;
if (!/^[a-f0-9-]{36}$/.test(a)) throw Error('Invalid account');
const after = query(
  `select jsonb_build_object('products',(select jsonb_agg(to_jsonb(p)) from ai_products p where account_id='${a}'),'media',(select jsonb_agg(to_jsonb(m)) from ai_product_media m where account_id='${a}'),'questions',(select jsonb_agg(to_jsonb(q)) from ai_catalog_questions q where account_id='${a}'),'projection',(select jsonb_agg(to_jsonb(c)) from catalog_items c where account_id='${a}')) snapshot`
)[0].snapshot;
fs.writeFileSync(`${dir}/after.json`, JSON.stringify(after, null, 2), {
  mode: 0o600,
});
for (const r of manifest.rows) {
  const p = after.products.find((p) => p.id === r.id);
  assert.ok(p, `Missing ${r.name}`);
  assert.equal(p.name, r.name);
  assert.equal(p.parent_id, r.parent_id);
  assert.equal(p.kind, r.kind);
}
for (const old of before.products) {
  const p = after.products.find((p) => p.id === old.id);
  assert.ok(p, 'Original identity missing');
  for (const k of [
    'price_min',
    'price_max',
    'price_unit',
    'price_notes',
    'sku',
    'tag_id',
  ])
    assert.deepEqual(p[k], old[k], `Preserved ${k} for ${old.name}`);
}
const decisions = JSON.parse(fs.readFileSync(`${dir}/media-decisions.json`));
assert.equal(after.media.length, before.media.length);
for (const old of before.media) {
  const p = after.media.find((m) => m.id === old.id);
  const assignment = decisions.assignments.find((d) => d.id === old.id);
  assert.deepEqual(p, { ...old, product_id: assignment?.to ?? old.product_id });
}
for (const old of before.questions)
  assert.deepEqual(
    after.questions.find((q) => q.id === old.id),
    old
  );
assert.equal(after.questions.length, before.questions.length + 2);
assert.equal(after.products.length, before.products.length + 18);
assert.equal(after.projection.length, after.products.length);
const fingerprint = query(fs.readFileSync(`${dir}/preservation.sql`, 'utf8'))[0]
  .preservation;
const previous = JSON.parse(fs.readFileSync(`${dir}/preservation-before.json`))
  .rows[0].preservation;
for (const t of Object.keys(previous).filter((t) => t !== 'catalog_items'))
  assert.deepEqual(fingerprint[t], previous[t], `Historical ${t} changed`);
const report = {
  verifiedAt: new Date().toISOString(),
  targetCategories: 11,
  targetProducts: 33,
  canonicalIdentities: after.products.length,
  projectionIdentities: after.projection.length,
  preservedOriginalProducts: before.products.length,
  preservedOriginalQuestions: before.questions.length,
  recordedShutterAnswers: 2,
  reassignedMedia: decisions.assignments.length,
  retainedMedia: decisions.retained.length,
  preservedHistory: Object.keys(previous).filter((t) => t !== 'catalog_items'),
};
fs.writeFileSync(`${dir}/verification.json`, JSON.stringify(report, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(report));
