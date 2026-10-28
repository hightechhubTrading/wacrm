/** Prepare a reversible HTH duplicate consolidation. Dry run unless --apply.
 * Requires migration 078. Retains every original ID, source note, price and file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const accountId = '21e37548-cb15-46e6-8556-510f47a538be';
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const { data: products, error } = await db
  .from('ai_products')
  .select('*,ai_product_media(id)')
  .eq('account_id', accountId);
if (error) throw error;
const pairs = [
  ['Window shutters · شتر النوافذ', 'أنظمة شتر النوافذ'],
  ['Rolling shutter doors · أبواب الشتر', 'أنظمة أبواب الكراجات والمحلات'],
  ['Garage shutter doors · أبواب شتر الكراجات', 'ابواب الكراجات لمداخل الفيلا'],
  ['Shop shutter doors · أبواب شتر المحلات', 'ابواب المحلات التجاريه أنواعها'],
  [
    'Australian rolling garage door · باب كراج رول أسترالي',
    'رول أسترالي للكراجات',
  ],
  [
    'American sectional garage door · باب كراج أمريكي',
    'أبواب أمريكية للكراجات',
  ],
  ['Solid steel shop shutter · شتر محل حديد صوليد', 'شتر حديد مصمت للمحلات'],
  ['Perforated shop shutter · شتر محل حديد مخرم', 'شتر حديد مخرم للمحلات'],
  [
    'Polycarbonate shop shutter · شتر محل بولي كربونايت',
    'شتر بولي كربونات شفاف للمحلات',
  ],
];
const one = (name) => {
  const rows = products.filter(
    (p) => p.name === name || p.aliases?.includes(name)
  );
  if (rows.length !== 1) throw Error(`Expected exactly one record: ${name}`);
  return rows[0];
};
const windowProduct = products.find(
  (p) => p.id === 'b281fe23-26af-4509-a01c-cbb8546c6e22'
);
if (!windowProduct || windowProduct.status !== 'approved')
  throw Error('Expected approved window product missing.');
const plan = pairs.map(([from, to]) => {
  const old = one(from),
    target = one(to);
  if (old.status !== 'draft' || target.status !== 'approved')
    throw Error(`Review status changed: ${from}`);
  if (old.superseded_by && old.superseded_by !== target.id)
    throw Error('Existing consolidation disagrees.');
  return {
    id: old.id,
    name: old.name,
    action: 'supersede',
    target: target.id,
    targetName: target.name,
    expected: old.updated_at,
    targetExpected: target.updated_at,
    done: old.superseded_by === target.id,
  };
});
for (const name of [
  'Motorized window shutters · شتر نوافذ كهربائي',
  'Manual window shutters · شتر نوافذ يدوي',
]) {
  const p = one(name);
  if (p.status !== 'draft' || p.superseded_by)
    throw Error('Window proposal changed; review required.');
  plan.push({
    id: p.id,
    name: p.name,
    action: 'reparent-as-variant',
    target: windowProduct.id,
    targetName: windowProduct.name,
    expected: p.updated_at,
    targetExpected: windowProduct.updated_at,
    done: p.kind === 'variant' && p.parent_id === windowProduct.id,
  });
}
for (const [id, name] of [
  ['b281fe23-26af-4509-a01c-cbb8546c6e22', 'شتر النوافذ'],
  ['eb501fd1-e022-4b39-8010-764fd8b863c9', 'أبواب الكراجات'],
  ['a1125167-5117-49a7-a1f5-2efc9633dec9', 'أبواب المحلات'],
]) {
  const p = products.find((p) => p.id === id);
  if (!p || p.status !== 'approved') throw Error('Approved product changed.');
  plan.push({
    id,
    name: p.name,
    action: 'rename',
    newName: name,
    target: id,
    targetName: name,
    expected: p.updated_at,
    targetExpected: p.updated_at,
    done: p.name === name,
  });
}
console.log(
  JSON.stringify(
    {
      mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
      supersede: 9,
      windowVariantsToRetain: 2,
      pending: plan.filter((p) => !p.done).length,
      originalRecordsDeleted: 0,
      pricesOrFilesChanged: 0,
      plan,
    },
    null,
    2
  )
);
if (!process.argv.includes('--apply') || plan.every((p) => p.done))
  process.exit(0);
if (!products.every((p) => 'superseded_by' in p))
  throw Error('Apply migration 078 before consolidation.');
const linked = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (
  !new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.startsWith(
    linked + '.'
  )
)
  throw Error('Linked project mismatch.');
const backup = fs.mkdtempSync(
  path.join(os.tmpdir(), 'hth-catalog-consolidation-')
);
fs.chmodSync(backup, 0o700);
fs.writeFileSync(
  path.join(backup, 'before.json'),
  JSON.stringify(products, null, 2),
  { mode: 0o600 }
);
const literal = (v) =>
  "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const sql = `BEGIN;
DO $consolidate$ DECLARE item jsonb; actual timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('${accountId}',77));
 FOR item IN SELECT value FROM jsonb_array_elements(${literal(plan.filter((p) => !p.done))}) LOOP
  SELECT updated_at INTO actual FROM public.ai_products WHERE id=(item->>'id')::uuid AND account_id='${accountId}' FOR UPDATE;
  IF NOT FOUND OR actual IS DISTINCT FROM (item->>'expected')::timestamptz THEN RAISE EXCEPTION 'Source changed; refresh plan'; END IF;
  SELECT updated_at INTO actual FROM public.ai_products WHERE id=(item->>'target')::uuid AND account_id='${accountId}' FOR UPDATE;
  IF NOT FOUND OR actual IS DISTINCT FROM (item->>'targetExpected')::timestamptz THEN RAISE EXCEPTION 'Target changed; refresh plan'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(${literal(plan.filter((p) => !p.done))}) LOOP
  IF item->>'action'='supersede' THEN
   UPDATE public.ai_products SET superseded_by=(item->>'target')::uuid WHERE id=(item->>'id')::uuid AND account_id='${accountId}';
  ELSIF item->>'action'='rename' THEN
   UPDATE public.ai_products SET aliases=ARRAY(SELECT DISTINCT v FROM unnest(aliases||ARRAY[name]) v),name=item->>'newName' WHERE id=(item->>'id')::uuid AND account_id='${accountId}';
  ELSE
   UPDATE public.ai_products SET parent_id=(item->>'target')::uuid,kind='variant' WHERE id=(item->>'id')::uuid AND account_id='${accountId}';
  END IF;
 END LOOP;
END $consolidate$;
COMMIT;`;
const file = path.join(backup, 'apply.sql');
fs.writeFileSync(file, sql, { mode: 0o600 });
const result = spawnSync(
  'supabase',
  ['db', 'query', '--linked', '--file', file],
  { encoding: 'utf8' }
);
if (result.status !== 0)
  throw Error(result.stderr || result.stdout || 'Consolidation failed.');
console.log('Consolidated. Private recovery snapshot:', backup);
