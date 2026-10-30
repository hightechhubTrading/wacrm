/** Disposable send-ledger constraint and RLS fixture. No external connections. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = id(1),
  other = id(2),
  agent = id(3),
  colleague = id(4),
  viewer = id(5),
  conversation = id(6),
  hidden = id(7),
  operation = id(8);
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE accounts(id uuid PRIMARY KEY);
 CREATE TABLE profiles(user_id uuid,account_id uuid,account_role text);
 CREATE FUNCTION is_account_member(a uuid,r text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=a AND (r='viewer' OR account_role IN ('owner','admin','agent')))$$;
 CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,assigned_agent_id uuid);
 CREATE TABLE messages(id uuid PRIMARY KEY);
 ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;CREATE POLICY c ON conversations FOR SELECT TO authenticated USING (
 is_account_member(account_id) AND (assigned_agent_id=auth.uid() OR EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_role IN ('owner','admin'))));
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 GRANT SELECT ON conversations,profiles TO authenticated;
 INSERT INTO accounts VALUES('${account}'),('${other}');INSERT INTO auth.users VALUES('${agent}'),('${colleague}'),('${viewer}');
 INSERT INTO profiles VALUES('${agent}','${account}','agent'),('${colleague}','${account}','agent'),('${viewer}','${account}','viewer');
 INSERT INTO conversations VALUES('${conversation}','${account}','${agent}'),('${hidden}','${other}','${agent}');`);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/087_outbound_send_operations.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(`SET ROLE service_role;INSERT INTO outbound_send_operations(id,account_id,user_id,conversation_id,request_hash)
 VALUES('${operation}','${account}','${agent}','${conversation}','${'a'.repeat(64)}');`);
  await assert.rejects(
    db.exec(`INSERT INTO outbound_send_operations(id,account_id,user_id,conversation_id,request_hash)
 VALUES('${operation}','${account}','${agent}','${conversation}','${'a'.repeat(64)}')`),
    /duplicate key/
  );
  await db.exec(
    `RESET ROLE;SET request.jwt.claim.sub='${agent}';SET ROLE authenticated;`
  );
  assert.equal(
    (await db.query('SELECT * FROM outbound_send_operations')).rows.length,
    1
  );
  for (const mutation of [
    'DELETE FROM outbound_send_operations',
    "UPDATE outbound_send_operations SET state='sent'",
    `INSERT INTO outbound_send_operations(id,account_id,user_id,conversation_id,request_hash) VALUES('${id(9)}','${account}','${agent}','${conversation}','${'b'.repeat(64)}')`,
  ]) {
    await assert.rejects(db.exec(mutation), /permission denied/);
  }
  for (const user of [colleague, viewer]) {
    await db.exec(
      `RESET ROLE;SET request.jwt.claim.sub='${user}';SET ROLE authenticated;`
    );
    assert.equal(
      (await db.query('SELECT * FROM outbound_send_operations')).rows.length,
      0
    );
  }
  await db.exec(
    `RESET ROLE;UPDATE conversations SET assigned_agent_id='${colleague}' WHERE id='${conversation}';SET request.jwt.claim.sub='${agent}';SET ROLE authenticated;`
  );
  assert.equal(
    (await db.query('SELECT * FROM outbound_send_operations')).rows.length,
    0
  );
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(
    db.query('SELECT * FROM outbound_send_operations'),
    /permission denied/
  );
  await db.exec(
    `RESET ROLE;UPDATE conversations SET assigned_agent_id='${agent}' WHERE id='${conversation}';UPDATE profiles SET account_id='${other}' WHERE user_id='${agent}';SET request.jwt.claim.sub='${agent}';SET ROLE authenticated;`
  );
  assert.equal(
    (await db.query('SELECT * FROM outbound_send_operations')).rows.length,
    0
  );
  console.log(
    'Send ledger SQL passed: unique claim, immutable browser access, actor/tenant/assignment/viewer/anonymous isolation.'
  );
} finally {
  await db.close();
}
