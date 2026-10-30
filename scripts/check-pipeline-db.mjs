/** Disposable SQL/RLS pipeline fixture. Never connects to the app database. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const account = '10000000-0000-0000-0000-000000000001',
  other = '10000000-0000-0000-0000-000000000002';
const agent = '20000000-0000-0000-0000-000000000001',
  otherAgent = '20000000-0000-0000-0000-000000000002';
const profile = '30000000-0000-0000-0000-000000000001',
  otherProfile = '30000000-0000-0000-0000-000000000002';
const pipeline = '40000000-0000-0000-0000-000000000001',
  stage = '50000000-0000-0000-0000-000000000001',
  stage2 = '50000000-0000-0000-0000-000000000002';
const contact = '60000000-0000-0000-0000-000000000001',
  special = '60000000-0000-0000-0000-000000000002',
  tag = '70000000-0000-0000-0000-000000000001';
const conversation = '80000000-0000-0000-0000-000000000001';
const id = (n) => `90000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(`
 CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION is_account_member(a uuid,r text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE AS $$SELECT a::text=current_setting('app.account')$$;
 CREATE TABLE pipelines(id uuid,account_id uuid);
 CREATE TABLE profiles(id uuid,user_id uuid,account_id uuid,full_name text,avatar_url text);
 CREATE TABLE contacts(id uuid,account_id uuid,name text,phone text);
 CREATE TABLE conversations(id uuid,account_id uuid,contact_id uuid,assigned_agent_id uuid,last_message_at timestamptz,updated_at timestamptz,ai_context_summary text,ai_context_summary_at timestamptz,ai_handoff_summary text);
 CREATE TABLE deals(id uuid,user_id uuid,account_id uuid,pipeline_id uuid,stage_id uuid,contact_id uuid,conversation_id uuid,assigned_to uuid,title text,notes text,value numeric,currency text,status text,expected_close_date date,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE tags(id uuid,account_id uuid,name text,color text);
 CREATE TABLE contact_tags(contact_id uuid,tag_id uuid);
 CREATE TABLE custom_fields(id uuid,field_name text,ai_collectible boolean);
 CREATE TABLE contact_custom_values(contact_id uuid,custom_field_id uuid,value text);
 CREATE TABLE ai_sales_assistance(conversation_id uuid,status text,analysis jsonb,updated_at timestamptz);
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
 GRANT SELECT ON pipelines,profiles,contacts,conversations,deals,tags,contact_tags,custom_fields,contact_custom_values,ai_sales_assistance TO authenticated;
 ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;CREATE POLICY pl ON pipelines TO authenticated USING(is_account_member(account_id));
 ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;CREATE POLICY ct ON contacts TO authenticated USING(is_account_member(account_id));
 ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;CREATE POLICY p ON profiles TO authenticated USING(is_account_member(account_id));
 ALTER TABLE deals ENABLE ROW LEVEL SECURITY;CREATE POLICY d ON deals TO authenticated USING(is_account_member(account_id) AND (current_setting('app.role')='owner' OR assigned_to IN (SELECT id FROM profiles WHERE user_id=auth.uid())));
 ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;CREATE POLICY c ON conversations TO authenticated USING(is_account_member(account_id));
 ALTER TABLE tags ENABLE ROW LEVEL SECURITY;CREATE POLICY t ON tags TO authenticated USING(is_account_member(account_id));
 INSERT INTO pipelines VALUES('${pipeline}','${account}'),('${id(2000)}','${other}');
 INSERT INTO profiles VALUES('${profile}','${agent}','${account}','Deal owner',NULL),('${otherProfile}','${otherAgent}','${account}','Chat owner',NULL);
 INSERT INTO contacts VALUES('${contact}','${account}','Synthetic customer','+15550000000'),('${special}','${account}','Outside first page','+15559999999');
 INSERT INTO tags VALUES('${tag}','${account}','Special family','#000000');INSERT INTO contact_tags VALUES('${special}','${tag}');
 INSERT INTO conversations VALUES('${conversation}','${account}','${special}','${otherAgent}','2026-10-27','2026-10-27','Context recap','2026-10-27',NULL);
 INSERT INTO ai_sales_assistance VALUES('${conversation}','ready','{"summary":"Newer brief"}','2026-10-28');
 INSERT INTO custom_fields VALUES('${id(3000)}','Product',true),('${id(3001)}','Private editor field',false);
 INSERT INTO contact_custom_values VALUES('${special}','${id(3000)}','Pivot door'),('${special}','${id(3001)}','Editor-only');
 INSERT INTO deals SELECT ('90000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${agent}','${account}','${pipeline}',
 CASE WHEN n%2=0 THEN '${stage}'::uuid ELSE '${stage2}'::uuid END,
 CASE WHEN n=1500 THEN '${special}'::uuid ELSE '${contact}'::uuid END,NULL,'${profile}',
 'Deal '||lpad(n::text,4,'0'),CASE WHEN n=1500 THEN 'Searchable editor notes' ELSE '' END,n,'QAR',
 CASE WHEN n=1 THEN 'won' WHEN n=2 THEN 'lost' ELSE 'open' END,
 CASE WHEN n=3 THEN '2026-10-26'::date WHEN n=4 THEN '2026-10-27'::date WHEN n=5 THEN '2026-10-30'::date ELSE NULL END,
 '2026-10-27'::timestamptz,'2026-10-27'::timestamptz FROM generate_series(1,1500)n;
 INSERT INTO deals VALUES('${id(1501)}','${agent}','${other}','${id(2000)}','${stage}','${special}',NULL,'${profile}','Secret','',999999,'QAR','open',NULL,now(),now());
 `);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/085_pipeline_list.sql', import.meta.url),
      'utf8'
    )
  );
  await db.exec(
    `SET ROLE authenticated;SET request.jwt.claim.sub='${agent}';SET app.account='${account}';SET app.role='owner';`
  );
  async function page({
    filters = {},
    view = 'board',
    page = 0,
    stages = {},
    p = pipeline,
  } = {}) {
    return (
      await db.query('SELECT pipeline_list($1,$2,$3,$4,$5,$6,$7,$8) AS data', [
        p,
        filters,
        view,
        page,
        stages,
        '2026-10-27',
        '2026-11-03',
        'USD',
      ])
    ).rows[0].data;
  }
  const board = await page();
  assert.equal(board.items.length, 12);
  assert.equal(board.total, 1500);
  assert.equal(board.summary.open, 1498);
  assert.equal(board.summary.won, 1);
  assert.equal(board.summary.overdue, 1);
  assert.equal(board.stageCounts[stage], 750);
  assert.equal(board.tags.length, 1);
  assert.equal(board.tagGroups.find((g) => g.id === tag).total, 1);
  const next = await page({ stages: { [stage]: 1 } });
  assert.equal(next.items.filter((d) => d.stage_id === stage).length, 6);
  assert.ok(
    next.items
      .filter((d) => d.stage_id === stage)
      .every((d) => !board.items.some((previous) => previous.id === d.id))
  );
  const search = await page({
    filters: { query: 'Outside first page' },
    view: 'list',
  });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].id, id(1500));
  assert.equal(search.items[0].conversationOwner.userId, otherAgent);
  assert.equal(search.items[0].conversationOwner.profileId, otherProfile);
  assert.equal(search.items[0].assigned_to, profile);
  assert.equal(search.items[0].aiSummary.text, 'Newer brief');
  assert.deepEqual(search.items[0].contact.customValues, [
    { field_name: 'Product', value: 'Pivot door' },
  ]);
  assert.ok(
    !('notes' in search.items[0]),
    'editor notes must not inflate every card'
  );
  assert.equal(
    (await page({ filters: { query: 'Searchable editor notes' } })).total,
    1
  );
  assert.equal((await page({ filters: { query: 'Special family' } })).total, 1);
  assert.equal((await page({ filters: { owner: otherProfile } })).total, 1);
  assert.equal((await page({ filters: { owner: profile } })).total, 1499);
  assert.equal((await page({ filters: { tag: '__untagged__' } })).total, 1499);
  assert.equal((await page({ filters: { tag } })).total, 1);
  assert.equal((await page({ filters: { status: 'won' } })).total, 1);
  assert.equal((await page({ filters: { due: 'overdue' } })).total, 1);
  assert.equal((await page({ filters: { due: 'today' } })).total, 1);
  assert.equal((await page({ filters: { due: 'week' } })).total, 2);
  assert.equal((await page({ filters: { due: 'undated' } })).total, 1497);
  assert.equal((await page({ filters: { stage } })).total, 750);
  assert.equal((await page({ filters: { currency: 'USD' } })).total, 0);
  assert.equal((await page({ view: 'tags' })).items.length, 6);
  assert.equal((await page({ view: 'list' })).items.length, 25);
  assert.equal((await page({ view: 'list', page: 9999 })).page, 59);
  for (const sort of [
    'newest',
    'oldest',
    'updated',
    'closing',
    'value',
    'title',
  ]) {
    const seen = new Set();
    for (let n = 0; n < 15; n++) {
      const result = await page({ filters: { sort }, view: 'export', page: n });
      assert.equal(result.items.length, 100);
      for (const row of result.items) {
        assert.ok(!seen.has(row.id));
        seen.add(row.id);
      }
    }
    assert.equal(seen.size, 1500);
  }
  assert.equal((await page({ p: id(2000) })).total, 0);
  await db.exec(
    `SET app.role='agent'; SET request.jwt.claim.sub='${otherAgent}'`
  );
  assert.equal((await page()).total, 0);
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(page(), /permission denied/);
  console.log(
    'Pipeline SQL checks passed: 1500 deals, bounded board/list/tag/export pages, global filters/facets/counts, all sorts/ties, conversation ownership, saved summaries, collectible fields, page clamping and tenant/assignment RLS.'
  );
} finally {
  await db.close();
}
