/** Disposable PostgreSQL checks. Uses no production credentials or customer records. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const account = '20000000-0000-4000-8000-000000000001',
  other = '20000000-0000-4000-8000-000000000002',
  user = '10000000-0000-4000-8000-000000000001';
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION is_account_member(a uuid,r text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT a::text=current_setting('app.account',true) AND auth.uid() IS NOT NULL AND (r IS NULL OR r='agent' OR current_setting('app.role',true)='admin')$$;
 CREATE TABLE accounts(id uuid PRIMARY KEY);INSERT INTO accounts VALUES('${account}'),('${other}');
 CREATE TABLE catalog_items(id uuid PRIMARY KEY,account_id uuid);
 CREATE TABLE profiles(id uuid,user_id uuid);INSERT INTO profiles VALUES('${user}','${user}');
 CREATE TABLE quotations(id uuid PRIMARY KEY,account_id uuid,assigned_to uuid,pdf_storage_path text,workspace_version integer);
 INSERT INTO quotations VALUES('${user}','${account}','${user}','issued.pdf',7),('10000000-0000-4000-8000-000000000099','${account}',NULL,'unassigned.pdf',1);
 ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;CREATE POLICY q ON quotations FOR SELECT TO authenticated USING(is_account_member(account_id,'agent'));
 GRANT SELECT ON quotations TO authenticated;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/090_quotation_knowledge.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(
    `SET ROLE authenticated;SET app.account='${account}';SET app.role='admin';SET request.jwt.claim.sub='${user}'`
  );
  const make = (client) => ({
    format: 1,
    version: client.repeat(64),
    label: 'Synthetic pack',
    sources: [{ file: 'fixture.csv', sha256: 'f'.repeat(64), rows: 5 }],
    records: [
      {
        key: 'client:2',
        kind: 'client',
        source: 'fixture.csv',
        row: 2,
        data: {
          client_key: 'Example Co',
          spelling_variants_seen: 'M/S Example Co. | شركة تجريبية',
        },
      },
      {
        key: 'quote:3',
        kind: 'quotation',
        source: 'fixture.csv',
        row: 3,
        data: { Client: 'EXAMPLE CO.', 'Status (fill in)': '' },
      },
      {
        key: 'invoice:4',
        kind: 'invoice',
        source: 'fixture.csv',
        row: 4,
        data: { Client: 'M/S Example Co.' },
      },
      {
        key: 'unrelated:5',
        kind: 'quotation',
        source: 'fixture.csv',
        row: 5,
        data: { Client: 'Other Co' },
      },
      {
        key: 'arabic:6',
        kind: 'job',
        source: 'fixture.csv',
        row: 6,
        data: { Client: 'شركة تجريبية' },
      },
    ],
  });
  const pack = make('a');
  await db.query(
    "SELECT save_quotation_sales_notes($1,0,'Price too high','2026-11-09')",
    [user]
  );
  await assert.rejects(
    db.query("SELECT save_quotation_sales_notes($1,0,'stale',NULL)", [user]),
    /Notes changed/
  );
  assert.equal(
    (await db.query('SELECT reason FROM quotation_sales_notes')).rows[0].reason,
    'Price too high'
  );
  const q = (await db.query('SELECT * FROM quotations')).rows[0];
  assert.equal(q.pdf_storage_path, 'issued.pdf');
  assert.equal(q.workspace_version, 7);
  const imported = await db.query(
    'SELECT import_quotation_knowledge($1,$2) AS id',
    [account, pack]
  );
  const batch = imported.rows[0].id;
  assert.equal(
    (
      await db.query('SELECT import_quotation_knowledge($1,$2) AS id', [
        account,
        pack,
      ])
    ).rows[0].id,
    batch
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM quotation_knowledge_records'
      )
    ).rows[0].n,
    5
  );
  const row = (
    await db.query(
      "SELECT * FROM quotation_knowledge_records WHERE kind='client'"
    )
  ).rows[0];
  assert.equal(row.review_status, 'pending');
  await db.query(
    "SELECT review_quotation_knowledge($1,0,'approved','Company confirmed spelling variants',$2)",
    [row.id, {}]
  );
  await assert.rejects(
    db.query(
      "SELECT review_quotation_knowledge($1,0,'rejected','stale review',$2)",
      [row.id, {}]
    ),
    /Review changed/
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM quotation_knowledge_reviews'
      )
    ).rows[0].n,
    1
  );
  const history = (
    await db.query('SELECT * FROM quotation_archive_history($1)', [row.id])
  ).rows;
  assert.equal(history.length, 3);
  assert.ok(history.some((r) => r.kind === 'job'));
  assert.ok(!history.some((r) => r.data.Client === 'Other Co'));
  // Foreign product references cannot be attached, even through the RPC.
  await db.exec('RESET ROLE');
  await db.exec(`INSERT INTO catalog_items VALUES('${user}','${other}')`);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query(
      "SELECT review_quotation_knowledge($1,1,'approved','foreign product',$2)",
      [row.id, { catalogItemId: user }]
    ),
    /Catalog item not found/
  );
  await assert.rejects(
    db.query("UPDATE quotation_knowledge_records SET data='{}' WHERE id=$1", [
      row.id,
    ]),
    /permission denied/
  );
  await db.exec(`SET app.role='agent'`);
  await assert.rejects(
    db.query(
      "SELECT save_quotation_sales_notes('10000000-0000-4000-8000-000000000099',0,'unassigned',NULL)"
    ),
    /Quotation not found/
  );
  await assert.rejects(
    db.query(
      "SELECT save_quotation_sales_notes($1,NULL,'bypass conflict',NULL)",
      [user]
    ),
    /Notes changed/
  );
  await db.query(
    "SELECT save_quotation_sales_notes($1,1,'Assigned agent follow-up','2026-11-10')",
    [user]
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM quotation_knowledge_records'
      )
    ).rows[0].n,
    5
  );
  await assert.rejects(
    db.query('SELECT import_quotation_knowledge($1,$2)', [account, make('b')]),
    /Administrator required/
  );
  await assert.rejects(
    db.query("SELECT review_quotation_knowledge($1,1,'approved','agent',$2)", [
      row.id,
      {},
    ]),
    /not found/
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM quotation_knowledge_reviews'
      )
    ).rows[0].n,
    1
  );
  await db.exec(`SET app.account='${other}';SET app.role='admin'`);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM quotation_knowledge_records'
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM quotation_sales_notes'))
      .rows[0].n,
    0
  );
  await assert.rejects(
    db.query("SELECT save_quotation_sales_notes($1,1,'foreign',NULL)", [user]),
    /Quotation not found/
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM quotation_archive_history($1)',
        [row.id]
      )
    ).rows[0].n,
    0
  );
  await assert.rejects(
    db.query(
      "SELECT review_quotation_knowledge($1,1,'approved','foreign',$2)",
      [row.id, {}]
    ),
    /not found/
  );
  await assert.rejects(
    db.query('SELECT import_quotation_knowledge($1,$2)', [account, make('b')]),
    /Administrator required/
  );
  if (process.env.QUOTATION_KNOWLEDGE_PACK) {
    await db.exec(`SET app.account='${account}';SET app.role='admin'`);
    const pack = JSON.parse(
      await readFile(process.env.QUOTATION_KNOWLEDGE_PACK, 'utf8')
    );
    const batch = (
      await db.query('SELECT import_quotation_knowledge($1,$2) AS id', [
        account,
        pack,
      ])
    ).rows[0].id;
    const counts = (
      await db.query(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE review_status='pending')::int AS pending FROM quotation_knowledge_records WHERE batch_id=$1",
        [batch]
      )
    ).rows[0];
    assert.equal(counts.total, pack.records.length);
    assert.equal(counts.pending, pack.records.length);
    console.log(
      `Private source pack validated in disposable PostgreSQL: ${pack.sources.length} sources, ${counts.total} records, all pending review.`
    );
  }
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(
    db.query('SELECT * FROM quotation_knowledge_records'),
    /permission denied/
  );
  console.log(
    'Quotation knowledge SQL passed: append-only source data, idempotent imports, pending defaults, version conflicts, review audit, catalog ownership, agent/admin boundaries, Arabic/English alias history, tenant and anonymous isolation.'
  );
} finally {
  await db.close();
}
