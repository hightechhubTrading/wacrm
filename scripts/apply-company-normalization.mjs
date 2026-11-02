/** Normalize a reviewed private company plan; --apply commits one transaction.
 * Original source data, quotation snapshots, identifiers and prices are retained.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const path = process.argv[2];
if (!path) throw Error('Provide a reviewed private plan');
const plan = JSON.parse(fs.readFileSync(path, 'utf8'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (
  !uuid.test(plan.accountId) ||
  !uuid.test(plan.userId) ||
  !/^[a-f0-9]{64}$/.test(plan.sourceVersion)
)
  throw Error('Invalid company context');
const allowed = [
  'name',
  'name_ar',
  'description',
  'status',
  'customer_visible',
  'parent_id',
  'limitations',
  'source_notes',
  'aliases',
  'specifications',
];
for (const p of plan.products)
  if (
    !uuid.test(p.id) ||
    Object.keys(p.patch).some((k) => !allowed.includes(k))
  )
    throw Error('Unsupported product change');
if (!uuid.test(plan.newFamily.id)) throw Error('Invalid family');
console.log(
  JSON.stringify({
    products: plan.products.length,
    documentedSources: plan.sources.filter((r) => r.status === 'approved')
      .length,
    answers: plan.answers.length,
    apply: process.argv.includes('--apply'),
  })
);
if (!process.argv.includes('--apply') && !process.argv.includes('--prepare'))
  process.exit(0);
process.loadEnvFile('.env.local');
const linked = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (
  !new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.startsWith(
    `${linked}.`
  )
)
  throw Error('Linked project differs from application');
const lit = (v) =>
    v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`,
  json = (v) => `${lit(JSON.stringify(v))}::jsonb`,
  a = lit(plan.accountId),
  u = lit(plan.userId);
const sql = [
  `BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='180s';SELECT pg_advisory_xact_lock(hashtextextended(${a},92));`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM profiles WHERE account_id=${a} AND user_id=${u} AND account_role IN ('owner','admin')) THEN RAISE EXCEPTION 'Account admin required'; END IF; END $$;`,
  `CREATE TEMP TABLE source_map ON COMMIT DROP AS SELECT r.* FROM quotation_knowledge_records r JOIN quotation_knowledge_batches b ON b.id=r.batch_id WHERE r.account_id=${a} AND b.source_version=${lit(plan.sourceVersion)};`,
  `DO $$ BEGIN IF (SELECT count(*) FROM source_map)<>${Number(plan.sources.length)} OR EXISTS(SELECT 1 FROM source_map WHERE review_version<>0) THEN RAISE EXCEPTION 'Source processing changed; rebuild the plan'; END IF;END $$;`,
  `GRANT SELECT ON source_map TO authenticated;SELECT set_config('request.jwt.claim.sub',${u},true);SET LOCAL ROLE authenticated;`,
];
const family = {
  ...plan.newFamily,
  account_id: plan.accountId,
  created_by: plan.userId,
};
sql.push(
  `INSERT INTO ai_products(id,account_id,created_by,name,description,kind,status,inventory_type,customer_visible) SELECT id,account_id,created_by,name,description,kind,status,inventory_type,customer_visible FROM jsonb_populate_record(NULL::ai_products,${json(family)}) ON CONFLICT(id) DO NOTHING;`
);
sql.push(
  `INSERT INTO product_source_links(account_id,product_id,source_record_id,relationship,notes) VALUES(${a},${lit(family.id)},(SELECT id FROM source_map WHERE record_key='products.csv:17'),'product','Company motor and equipment family; original MOT code retained in quotation references.') ON CONFLICT(product_id,source_record_id) DO NOTHING;`
);
for (const p of plan.products) {
  sql.push(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM ai_products WHERE id=${lit(p.id)} AND account_id=${a} AND updated_at=${lit(p.expectedUpdatedAt)}::timestamptz) THEN RAISE EXCEPTION 'Product changed during normalization';END IF;END $$;`
  );
  const fields = Object.keys(p.patch);
  sql.push(
    `UPDATE ai_products SET (${fields.join(',')})=(SELECT ${fields.map((k) => `f.${k}`).join(',')} FROM jsonb_populate_record(NULL::ai_products,${json(p.patch)}) f) WHERE account_id=${a} AND id=${lit(p.id)};`
  );
}
for (const q of plan.answers) {
  sql.push(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM ai_catalog_questions WHERE id=${lit(q.id)} AND account_id=${a} AND updated_at=${lit(q.expectedUpdatedAt)}::timestamptz AND answer='') THEN RAISE EXCEPTION 'Staff answer changed';END IF;END $$;UPDATE ai_catalog_questions SET answer=${lit(q.answer)},evidence=${lit(q.evidence)}${q.status === 'closed' ? ",status='closed'" : ''} WHERE id=${lit(q.id)} AND account_id=${a};`
  );
}
for (const f of plan.findingChanges)
  sql.push(
    `UPDATE catalog_question_findings SET finding=${lit(f.finding)}${f.coverage === 'answers' ? ",coverage='answers',remaining_question=''" : ''} WHERE account_id=${a} AND question_id=${lit(f.question_id)} AND source_record_id=(SELECT id FROM source_map WHERE record_key=${lit(f.source_key)}) AND finding=${lit(f.previous)};`
  );
for (const q of plan.questionChanges)
  sql.push(
    `UPDATE ai_catalog_questions SET question=${lit(q.question)} WHERE account_id=${a} AND id=${lit(q.id)} AND updated_at=${lit(q.expectedUpdatedAt)}::timestamptz;`
  );
for (const [code, label] of Object.entries(plan.productCodes))
  sql.push(
    `INSERT INTO quotation_product_codes(account_id,code,label) VALUES(${a},${lit(code)},${lit(label)}) ON CONFLICT(account_id,code) DO UPDATE SET label=EXCLUDED.label;`
  );
// The existing versioned RPC audits evidence acceptance; calculation settings stay explicit.
for (const r of plan.sources)
  if (!['approved', 'rejected'].includes(r.status))
    throw Error('Invalid source state');
sql.push(`DO $process$ DECLARE entry jsonb; source_id uuid; BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements(${json(plan.sources)}) LOOP
  SELECT id INTO source_id FROM source_map WHERE record_key=entry->>'key';
  PERFORM review_quotation_knowledge(source_id,0,entry->>'status',CASE WHEN entry->>'status'='approved' THEN 'Normalized from supplied company records under the owner’s instruction. Recorded facts are accepted; missing price columns, units, currencies or landed charges remain separate calculation settings.' ELSE 'Superseded extraction retained for traceability; use its normalized successor.' END,entry->'configuration');
 END LOOP;
END $process$;`);
sql.push('COMMIT;');
const file = path + '.sql';
fs.writeFileSync(file, sql.join('\n'), { mode: 0o600 });
if (process.argv.includes('--prepare')) {
  console.log('Reviewed SQL prepared; no database changes.');
  process.exit(0);
}
const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
if (r.status !== 0) {
  fs.writeFileSync(
    path + '.error.log',
    JSON.stringify({
      status: r.status,
      signal: r.signal,
      error: r.error?.message,
      stdout: r.stdout,
      stderr: r.stderr,
    }),
    { mode: 0o600 }
  );
  throw Error(
    'Normalization transaction did not report success; inspect the private error log and database state before retrying.'
  );
}
fs.writeFileSync(path + '.result.json', r.stdout, { mode: 0o600 });
console.log('Company normalization committed.');
