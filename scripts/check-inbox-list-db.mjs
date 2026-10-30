/** Disposable SQL/RLS/keyset fixture. Never connects to the app database. */
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
  contact = '30000000-0000-0000-0000-000000000001',
  special = '30000000-0000-0000-0000-000000000002';
const id = (n) => `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(`
 CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION is_account_member(a uuid,r text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT a::text=current_setting('app.account') AND (r='viewer' OR current_setting('app.role') IN ('agent','owner'))$$;
 CREATE TABLE contacts(id uuid,account_id uuid,name text,phone text,company text);
 CREATE TABLE conversations(id uuid,user_id uuid,account_id uuid,contact_id uuid,status text,assigned_agent_id uuid,last_message_text text,last_message_at timestamptz,unread_count integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),ai_priority text,ai_priority_reason text,ai_autoreply_disabled boolean,ai_reply_count integer,ai_handoff_summary text,ai_context_summary text,ai_context_summary_at timestamptz,ad_source_id text,ad_headline text,ad_clicked_at timestamptz);
 CREATE TABLE messages(id uuid,conversation_id uuid,sender_type text,status text,created_at timestamptz);
 CREATE TABLE ai_followups(id uuid,account_id uuid,conversation_id uuid,owner_id uuid,due_at timestamptz,status text);
 CREATE TABLE deals(id uuid,account_id uuid,conversation_id uuid,contact_id uuid);
 CREATE TABLE group_handoffs(id uuid,account_id uuid,deal_id uuid,kind text,status text,due_at timestamptz);
 CREATE TABLE contact_tags(contact_id uuid,tag_id uuid);
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
 GRANT SELECT ON contacts,conversations,messages,ai_followups,deals,group_handoffs,contact_tags TO authenticated;
 ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;CREATE POLICY c ON conversations TO authenticated USING(is_account_member(account_id) AND (current_setting('app.role') IN ('owner','viewer') OR assigned_agent_id=auth.uid()));
 ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;CREATE POLICY ct ON contacts TO authenticated USING(is_account_member(account_id));
 ALTER TABLE messages ENABLE ROW LEVEL SECURITY;CREATE POLICY m ON messages TO authenticated USING(EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id));
 ALTER TABLE ai_followups ENABLE ROW LEVEL SECURITY;CREATE POLICY f ON ai_followups TO authenticated USING(is_account_member(account_id));
 ALTER TABLE deals ENABLE ROW LEVEL SECURITY;CREATE POLICY d ON deals TO authenticated USING(is_account_member(account_id));
 ALTER TABLE group_handoffs ENABLE ROW LEVEL SECURITY;CREATE POLICY h ON group_handoffs TO authenticated USING(is_account_member(account_id));
 INSERT INTO contacts VALUES('${contact}','${account}','Synthetic customer','+15550000000','Example'),('${special}','${account}','Outside first page','+15559999999','Remote company');
 INSERT INTO conversations(id,user_id,account_id,contact_id,status,assigned_agent_id,last_message_text,last_message_at,unread_count,ai_priority)
 SELECT ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${agent}','${account}',CASE WHEN n=1500 THEN '${special}'::uuid ELSE '${contact}'::uuid END,
 CASE WHEN n=1499 THEN 'closed' ELSE 'open' END,'${agent}','Message '||n,
 CASE WHEN n%13=0 THEN NULL ELSE '2026-10-27 09:00Z'::timestamptz END,n%2,
 CASE WHEN n%5=0 THEN 'urgent' WHEN n%5=1 THEN 'high' ELSE 'normal' END FROM generate_series(1,1500)n;
 INSERT INTO conversations(id,user_id,account_id,contact_id,status,last_message_at,unread_count) VALUES('${id(1501)}','${agent}','${other}','${contact}','open',now(),1);
 INSERT INTO messages VALUES('${id(2001)}','${id(1500)}','customer','delivered','2026-10-27 09:00Z'),('${id(2002)}','${id(1496)}','agent','delivered','2026-10-27 09:00Z');
 INSERT INTO ai_followups VALUES('${id(2003)}','${account}','${id(1498)}',NULL,'2026-10-27 10:00Z','open');
 INSERT INTO deals VALUES('${id(2004)}','${account}','${id(1497)}','${contact}');
 INSERT INTO group_handoffs VALUES('${id(2005)}','${account}','${id(2004)}','measurement','waiting','2026-10-28 10:00Z');
 INSERT INTO contact_tags VALUES('${special}','${id(2006)}');
 `);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/084_inbox_list.sql', import.meta.url),
      'utf8'
    )
  );
  await db.exec(
    `SET ROLE authenticated;SET request.jwt.claim.sub='${agent}';SET app.account='${account}';SET app.role='owner';`
  );
  async function page({
    search = '',
    view = 'all',
    sort = 'priority',
    tags = [],
    company = null,
    assigned = null,
    cursor = null,
    limit = 50,
    a = account,
    sales = true,
    metadataOnly = false,
  } = {}) {
    const result = await db.query(
      'SELECT inbox_list($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS data',
      [
        a,
        search,
        view,
        sort,
        tags,
        company,
        assigned,
        '2026-10-27 23:59:59Z',
        cursor,
        limit,
        sales,
        metadataOnly,
      ]
    );
    return result.rows[0].data;
  }
  const core = await page({ sales: false });
  assert.equal(core.items.length, 50);
  assert.equal(core.counts.all, 1500);
  assert.equal(core.counts.needs_reply, undefined);
  const metadata = await page({ metadataOnly: true });
  assert.equal(metadata.items.length, 0);
  assert.equal(metadata.counts.needs_reply, 1);
  assert.equal(metadata.nextCursor, null);
  const first = await page();
  assert.equal(first.items.length, 50);
  assert.equal(first.total, 1500);
  assert.equal(first.counts.all, 1500);
  assert.deepEqual(first.companies, ['Example', 'Remote company']);
  assert.equal(
    (await page({ search: 'Outside first page' })).items[0].id,
    id(1500)
  );
  assert.equal((await page({ company: 'Remote company' })).total, 1);
  assert.equal((await page({ tags: [id(2006)] })).total, 1);
  assert.equal((await page({ view: 'needs_reply' })).items[0].id, id(1500));
  assert.equal(
    (await page({ view: 'waiting_customer' })).items[0].id,
    id(1496)
  );
  assert.equal((await page({ view: 'followup_today' })).items[0].id, id(1498));
  assert.equal(
    (await page({ view: 'waiting_measurement' })).items[0].id,
    id(1497)
  );
  assert.equal((await page({ assigned: '__unassigned__' })).total, 0);
  assert.equal((await page({ a: other })).total, 0);
  for (const sort of ['priority', 'newest', 'oldest']) {
    let cursor = null;
    const seen = new Set();
    let reads = 0;
    do {
      const data = await page({ sort, cursor });
      for (const item of data.items) {
        assert.ok(!seen.has(item.id), 'duplicate keyset row');
        seen.add(item.id);
      }
      cursor = data.nextCursor;
      assert.ok(++reads <= 30, 'cursor did not terminate');
    } while (cursor);
    assert.equal(seen.size, 1500);
  }
  // A small final page must terminate, rather than returning an earlier cursor.
  assert.equal((await page({ search: 'Outside first page' })).nextCursor, null);
  await db.exec(`SET app.role='viewer'`);
  assert.equal((await page({ view: 'needs_reply' })).total, 0);
  await db.exec(
    `SET app.role='agent'; SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002'`
  );
  assert.equal((await page()).total, 0);
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(page(), /permission denied/);
  console.log(
    'Inbox SQL checks passed: 1500 rows, bounded pages, global search/facets/counts/sales views, three keyset sorts, tied/null timestamps, final cursor, tenant/assignment/viewer RLS and anonymous denial.'
  );
} finally {
  await db.close();
}
