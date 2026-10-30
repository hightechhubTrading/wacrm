/** Disposable activity authorization, ordering and expiry fixture; no live database. */
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
  foreign = id(2),
  owner = id(3),
  agent = id(4),
  other = id(5),
  viewer = id(6),
  outsider = id(7),
  conv = id(8),
  hidden = id(9),
  tab = id(10),
  ownerTab = id(11);
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE accounts(id uuid PRIMARY KEY);CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE profiles(user_id uuid PRIMARY KEY,account_id uuid,account_role text,full_name text);
 CREATE FUNCTION is_account_member(a uuid,r text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=a AND (r='viewer' OR r='agent' AND account_role IN ('agent','owner','admin') OR r='admin' AND account_role IN ('owner','admin')))$$;
 CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,assigned_agent_id uuid);
 ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;CREATE POLICY c ON conversations FOR SELECT TO authenticated USING(is_account_member(account_id,'admin') OR is_account_member(account_id,'agent') AND assigned_agent_id=auth.uid());
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;GRANT SELECT ON conversations,profiles TO authenticated;
 INSERT INTO accounts VALUES('${account}'),('${foreign}');INSERT INTO auth.users VALUES('${owner}'),('${agent}'),('${other}'),('${viewer}'),('${outsider}');
 INSERT INTO profiles VALUES('${owner}','${account}','owner','Maha'),('${agent}','${account}','agent','Ali'),('${other}','${account}','agent','Hassan'),('${viewer}','${account}','viewer','Read-only'),('${outsider}','${foreign}','owner','Other account');
 INSERT INTO conversations VALUES('${conv}','${account}','${agent}'),('${hidden}','${account}','${other}');`);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/089_conversation_activity.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  const as = async (user) =>
    db.exec(
      `RESET ROLE;SET request.jwt.claim.sub='${user}';SET ROLE authenticated;`
    );
  const record = async (
    sequence,
    composing = false,
    leave = false,
    c = conv,
    t = tab
  ) =>
    (
      await db.query(
        'SELECT record_conversation_activity($1,$2,$3,$4,$5) result',
        [c, t, sequence, composing, leave]
      )
    ).rows[0].result;
  const snapshot = async (c = conv, t = ownerTab) =>
    (
      await db.query('SELECT conversation_activity_snapshot($1,$2) result', [
        c,
        t,
      ])
    ).rows[0].result;
  await as(agent);
  assert.equal((await record(1)).peers.length, 0);
  await as(owner);
  let result = await record(1, false, false, conv, ownerTab);
  assert.equal(result.peers.length, 1);
  assert.equal(result.peers[0].userId, agent);
  assert.equal(result.peers[0].name, 'Ali');
  await as(agent);
  await record(3, false, true);
  await record(2, true, false);
  await as(owner);
  assert.equal((await snapshot()).peers.length, 0);
  await as(agent);
  await record(4, true);
  await as(owner);
  result = await snapshot();
  assert.ok(
    Date.parse(result.peers[0].composingUntil) > Date.parse(result.serverNow)
  );
  await db.exec(
    `RESET ROLE;UPDATE conversation_activity SET last_seen_at=now()-interval '46 seconds' WHERE user_id='${agent}';`
  );
  await as(owner);
  assert.equal((await snapshot()).peers.length, 0);
  await as(agent);
  await record(5);
  await assert.rejects(record(0), /Invalid activity request/);
  await assert.rejects(
    record(1, false, false, hidden),
    /Conversation unavailable/
  );
  await assert.rejects(
    db.exec('UPDATE conversation_activity SET active=false'),
    /permission denied/
  );
  await as(other);
  assert.equal((await snapshot()).peers.length, 0);
  await assert.rejects(record(1), /Conversation unavailable/);
  await as(outsider);
  assert.equal((await snapshot()).peers.length, 0);
  await assert.rejects(record(1), /Conversation unavailable/);
  await as(viewer);
  assert.equal((await snapshot()).peers.length, 0);
  await assert.rejects(record(1), /Conversation unavailable/);
  await db.exec(
    `RESET ROLE;UPDATE conversations SET assigned_agent_id='${other}' WHERE id='${conv}';`
  );
  await as(agent);
  assert.equal((await snapshot()).peers.length, 0);
  await assert.rejects(record(6), /Conversation unavailable/);
  await as(owner);
  assert.equal((await snapshot()).peers.length, 0); // Old assignee must not remain a peer.
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(snapshot(), /permission denied/);
  await assert.rejects(record(1), /permission denied/);
  await db.exec('RESET ROLE;SET ROLE service_role');
  await assert.rejects(record(1), /permission denied/);
  console.log(
    'Activity SQL passed: actor/tenant/assignment/viewer/anonymous boundaries, tombstones, sequence ordering, composing expiry and stale-peer filtering.'
  );
} finally {
  await db.close();
}
