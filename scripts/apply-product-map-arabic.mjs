/** Complete Arabic descriptions without altering identity, price or source evidence. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { arabicDescriptions } from './product-map-data.mjs';
const dir = '.local/product-map',
  s = JSON.parse(fs.readFileSync(`${dir}/followup-after.json`)),
  m = JSON.parse(fs.readFileSync(`${dir}/manifest.json`));
process.loadEnvFile('.env.local');
if (
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
  `${fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim()}.supabase.co`
)
  throw Error('Project mismatch');
const a = m.accountId,
  u = m.userId,
  lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const sql = [
  `BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(hashtextextended(${lit(a)},101));`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM profiles WHERE account_id=${lit(a)} AND user_id=${lit(u)} AND account_role IN ('owner','admin')) THEN RAISE EXCEPTION 'Admin required';END IF;END $$;`,
  `CREATE TEMP TABLE before_ar AS SELECT * FROM ai_products WHERE account_id=${lit(a)};`,
];
for (const r of m.rows.filter((r) => r.kind === 'product')) {
  const old = s.products.find((p) => p.id === r.id),
    text = arabicDescriptions[r.name];
  if (!text) throw Error('Missing Arabic description');
  sql.push(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM ai_products WHERE id=${lit(r.id)} AND account_id=${lit(a)} AND updated_at=${lit(old.updated_at)}::timestamptz) THEN RAISE EXCEPTION 'Product changed';END IF;END $$;UPDATE ai_products SET description_ar=${lit(text)} WHERE account_id=${lit(a)} AND id=${lit(r.id)};`
  );
}
sql.push(
  `DO $$ BEGIN IF EXISTS(SELECT 1 FROM before_ar b FULL JOIN ai_products p ON p.id=b.id AND p.account_id=b.account_id WHERE (b.account_id=${lit(a)} OR p.account_id=${lit(a)}) AND (b.id IS NULL OR p.id IS NULL OR (to_jsonb(b)-'description_ar'-'updated_at') IS DISTINCT FROM (to_jsonb(p)-'description_ar'-'updated_at'))) THEN RAISE EXCEPTION 'Unrelated product data changed';END IF;END $$;`,
  process.argv.includes('--apply') ? 'COMMIT;' : 'ROLLBACK;'
);
fs.writeFileSync(`${dir}/arabic.sql`, sql.join('\n'), { mode: 0o600 });
const r = spawnSync(
  'supabase',
  ['db', 'query', '--linked', '--file', `${dir}/arabic.sql`, '-o', 'json'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
);
fs.writeFileSync(
  `${dir}/arabic-${process.argv.includes('--apply') ? 'applied' : 'rehearsal'}.json`,
  r.stdout || r.stderr,
  { mode: 0o600 }
);
if (r.status) throw Error(r.stderr || r.stdout);
console.log(
  process.argv.includes('--apply')
    ? 'Committed 33 Arabic descriptions'
    : 'Arabic rehearsal passed and rolled back'
);
