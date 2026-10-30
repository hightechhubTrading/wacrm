/** Historical message search/context SQL with RLS and >1,000 synthetic messages. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const id = (prefix, n) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = id(1, 1),
  other = id(1, 2),
  agent = id(2, 1),
  colleague = id(2, 2),
  viewer = id(2, 3),
  owner = id(2, 4),
  conv = id(3, 1),
  hidden = id(3, 2),
  foreign = id(3, 3),
  contact = id(5, 1),
  message = (n) => id(4, n);
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE profiles(user_id uuid,account_id uuid,account_role text);
 CREATE FUNCTION is_account_member(a uuid,r text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=a AND (r='viewer' OR r='agent' AND account_role IN ('agent','admin','owner') OR r='admin' AND account_role IN ('admin','owner')))$$;
 CREATE TABLE contacts(id uuid PRIMARY KEY,account_id uuid,name text,phone text);
 CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,contact_id uuid,assigned_agent_id uuid);
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,content_text text,transcript text,sender_type text,content_type text,created_at timestamptz,status text);
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;GRANT SELECT ON conversations,contacts,messages TO authenticated;
 ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;CREATE POLICY c ON conversations FOR SELECT TO authenticated USING(is_account_member(account_id,'admin') OR is_account_member(account_id,'agent') AND assigned_agent_id=auth.uid());
 ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;CREATE POLICY ct ON contacts FOR SELECT TO authenticated USING(is_account_member(account_id));
 ALTER TABLE messages ENABLE ROW LEVEL SECURITY;CREATE POLICY m ON messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id));
 INSERT INTO profiles VALUES('${agent}','${account}','agent'),('${colleague}','${account}','agent'),('${viewer}','${account}','viewer'),('${owner}','${account}','owner');
 INSERT INTO contacts VALUES('${contact}','${account}','Synthetic customer','+15550000000');
 INSERT INTO conversations VALUES('${conv}','${account}','${contact}','${agent}'),('${hidden}','${account}','${contact}','${colleague}'),('${foreign}','${other}',NULL,'${agent}');
 INSERT INTO messages SELECT ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${conv}',
 CASE WHEN n=1499 THEN 'window نافذة' ELSE 'window '||n END,CASE WHEN n=1500 THEN 'aluminium voice-only transcript' ELSE NULL END,
 CASE WHEN n%3=0 THEN 'customer' WHEN n%3=1 THEN 'agent' ELSE 'bot' END,CASE WHEN n=1500 THEN 'audio' ELSE 'text' END,CASE WHEN n<=60 THEN NULL ELSE '2026-10-01T09:00:00Z'::timestamptz END,'sent' FROM generate_series(1,1500)n;
 INSERT INTO messages VALUES('${message(2001)}','${hidden}','window hidden',NULL,'customer','text','2026-10-01T09:00:00Z','sent'),('${message(2002)}','${foreign}','window foreign',NULL,'customer','text','2026-10-01T09:00:00Z','sent');`);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/088_message_history_search.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  const as = async (user) =>
    db.exec(
      `RESET ROLE;SET request.jwt.claim.sub='${user}';SET ROLE authenticated;`
    );
  const search = async (
    query = 'window',
    {
      conversation = null,
      sender = null,
      from = null,
      to = null,
      cursor = null,
      limit = 50,
      scope = account,
    } = {}
  ) =>
    (
      await db.query(
        'SELECT search_inbox_messages($1,$2,$3,$4,$5,$6,$7,$8) result',
        [
          scope,
          query,
          conversation,
          sender,
          from,
          to,
          cursor ? JSON.stringify(cursor) : null,
          limit,
        ]
      )
    ).rows[0].result;
  const context = async (m, c = conv, scope = account) =>
    (
      await db.query('SELECT inbox_message_context($1,$2,$3) result', [
        scope,
        c,
        m,
      ])
    ).rows[0].result;
  await as(agent);
  let result = await search(),
    seen = [];
  do {
    assert.equal(result.total, 1500);
    assert.ok(result.items.length <= 50);
    seen.push(...result.items.map((m) => m.id));
    if (!result.nextCursor) break;
    result = await search('window', { cursor: result.nextCursor });
  } while (true);
  assert.equal(seen.length, 1500);
  assert.equal(new Set(seen).size, 1500);
  assert.equal(seen[0], message(1500));
  assert.equal(seen.at(-1), message(1));
  assert.equal((await search('نافذة')).total, 1);
  result = await search('aluminium');
  assert.equal(result.items[0].source, 'transcript');
  assert.match(result.items[0].excerpt, /⟦aluminium⟧/);
  assert.equal((await search('window', { sender: 'customer' })).total, 500);
  assert.equal((await search('window', { conversation: hidden })).total, 0);
  assert.equal((await search('window', { scope: other })).total, 0);
  assert.equal(
    (
      await search('window', {
        from: '2026-10-01T09:00:00Z',
        to: '2026-10-01T09:00:01Z',
      })
    ).total,
    1440
  );
  assert.equal(
    (await search('window', { to: '2026-10-01T09:00:00Z' })).total,
    0
  );
  assert.equal((await search('window', { limit: 100000 })).items.length, 50);
  assert.equal((await search('x')).total, 0);
  assert.equal((await search('---')).total, 0);
  result = await context(message(750));
  assert.equal(result.found, true);
  assert.equal(result.messages.length, 41);
  assert.equal(result.messages[20].id, message(750));
  result = await context(message(1));
  assert.equal(result.messages[0].id, message(1));
  assert.equal(result.messages.length, 21);
  assert.equal((await context(message(750), hidden)).found, false);
  assert.equal((await context(message(2001), hidden)).found, false);
  assert.equal((await context(message(750), conv, other)).found, false);
  await as(colleague);
  assert.equal((await search()).total, 1);
  assert.equal((await context(message(750))).found, false);
  await as(viewer);
  assert.equal((await search()).total, 0);
  assert.equal((await context(message(750))).found, false);
  await as(owner);
  assert.equal((await search()).total, 1501);
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(search(), /permission denied/);
  await assert.rejects(context(message(750)), /permission denied/);
  console.log(
    'Historical search SQL passed: full paging, tied cursors, Arabic, transcripts, filters/dates, bounded context, tenant/assignment/viewer/anonymous isolation.'
  );
} finally {
  await db.close();
}
