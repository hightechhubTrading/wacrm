/** Apply a private, reviewed reconciliation plan. Defaults to a read-only summary.
 * No source approvals or existing product/question facts are changed.
 * Usage: node scripts/apply-shared-inventory-plan.mjs private-plan.json [--apply]
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const planPath = process.argv[2];
if (!planPath) throw Error('Provide a private reconciliation plan.');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (
  !uuid.test(plan.accountId) ||
  !uuid.test(plan.userId) ||
  !/^[a-f0-9]{64}$/.test(plan.sourceVersion)
)
  throw Error('Invalid account, actor or source version');
for (const p of plan.products)
  if (
    !uuid.test(p.id) ||
    p.status !== 'draft' ||
    p.customer_visible !== false ||
    p.price_min != null ||
    p.price_max != null
  )
    throw Error('New inventory records must be unpriced internal drafts');
for (const f of plan.findings)
  if (
    !uuid.test(f.question_id) ||
    !['partial', 'not_answered', 'answers'].includes(f.coverage)
  )
    throw Error('Invalid finding');
console.log(
  JSON.stringify({
    account: plan.accountId,
    draftProducts: plan.products.length,
    newQuestions: plan.questions.length,
    findings: plan.findings.length,
    links: plan.links.length,
    apply: process.argv.includes('--apply'),
  })
);
if (!process.argv.includes('--apply')) process.exit(0);
process.loadEnvFile('.env.local');
const linked = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (
  !new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.startsWith(
    `${linked}.`
  )
)
  throw Error('Linked database differs from application');
const lit = (v) =>
  v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const a = lit(plan.accountId),
  u = lit(plan.userId);
const sql = [
  `BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'; SELECT pg_advisory_xact_lock(hashtextextended(${a},91));`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=${a} AND owner_user_id=${u}) AND NOT EXISTS(SELECT 1 FROM profiles WHERE account_id=${a} AND user_id=${u} AND account_role IN ('owner','admin')) THEN RAISE EXCEPTION 'Account admin required'; END IF; END $$;`,
  `CREATE TEMP TABLE source_map ON COMMIT DROP AS SELECT r.id,r.record_key FROM quotation_knowledge_records r JOIN quotation_knowledge_batches b ON b.id=r.batch_id WHERE r.account_id=${a} AND b.source_version=${lit(plan.sourceVersion)};`,
  `DO $$ BEGIN IF (SELECT count(*) FROM source_map)<>${plan.sourceCount} THEN RAISE EXCEPTION 'Source snapshot changed'; END IF; END $$;`,
];
// Check staff records have not changed since review. Preserve answers, confirmation and status.
for (const q of plan.expectedQuestions)
  sql.push(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM ai_catalog_questions WHERE id=${lit(q.id)} AND account_id=${a} AND updated_at=${lit(q.updated_at)}::timestamptz) THEN RAISE EXCEPTION 'Question changed during review'; END IF; END $$;`
  );
for (const p of plan.products) {
  const row = { ...p, account_id: plan.accountId, created_by: plan.userId };
  sql.push(
    `INSERT INTO ai_products(id,account_id,created_by,name,description,kind,parent_id,status,inventory_type,sku,unit_of_measure,customer_visible,source_notes) SELECT id,account_id,created_by,name,description,kind,parent_id,status,inventory_type,sku,unit_of_measure,customer_visible,source_notes FROM jsonb_populate_record(NULL::ai_products,${json(row)}) ON CONFLICT(id) DO NOTHING;`
  );
}
for (const q of plan.questions)
  sql.push(
    `INSERT INTO ai_catalog_questions(account_id,created_by,product_id,gap_key,question,evidence) VALUES(${a},${u},${lit(q.product_id)},${lit(q.gap_key)},${lit(q.question)},${lit(q.evidence)}) ON CONFLICT(account_id,gap_key) DO NOTHING;`
  );
for (const f of plan.findings)
  sql.push(
    `INSERT INTO catalog_question_findings(account_id,created_by,question_id,source_record_id,coverage,finding,remaining_question) VALUES(${a},${u},${lit(f.question_id)},(SELECT id FROM source_map WHERE record_key=${lit(f.source_key)}),${lit(f.coverage)},${lit(f.finding)},${lit(f.remaining_question)}) ON CONFLICT(question_id,source_record_id) DO NOTHING;`
  );
for (const l of plan.links)
  sql.push(
    `INSERT INTO product_source_links(account_id,product_id,source_record_id,relationship,notes) VALUES(${a},${lit(l.product_id)},(SELECT id FROM source_map WHERE record_key=${lit(l.source_key)}),${lit(l.relationship)},${lit(l.notes)}) ON CONFLICT(product_id,source_record_id) DO NOTHING;`
  );
sql.push(
  `SELECT jsonb_build_object('products',(SELECT count(*) FROM ai_products WHERE account_id=${a}),'questions',(SELECT count(*) FROM ai_catalog_questions WHERE account_id=${a}),'findings',(SELECT count(*) FROM catalog_question_findings WHERE account_id=${a}),'links',(SELECT count(*) FROM product_source_links WHERE account_id=${a})) result; COMMIT;`
);
const sqlPath = `${planPath}.sql`;
fs.writeFileSync(sqlPath, sql.join('\n'), { mode: 0o600 });
const result = spawnSync(
  'supabase',
  ['db', 'query', '--linked', '--file', sqlPath],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
);
if (result.status !== 0) throw Error(result.stderr || result.stdout);
console.log('Reconciliation transaction committed.');
fs.writeFileSync(`${planPath}.result.json`, result.stdout, { mode: 0o600 });
