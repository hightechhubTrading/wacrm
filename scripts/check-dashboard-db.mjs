/** Disposable SQL/RLS checks; never connects to the app database. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE TABLE conversations(id text,account_id text,assigned_to uuid,status text,created_at timestamptz);
    CREATE TABLE contacts(id text,account_id text,created_at timestamptz);
    CREATE TABLE deals(id text,account_id text,stage_id text,status text,value numeric);
    CREATE TABLE pipeline_stages(id text,account_id text,name text,color text,position integer);
    CREATE TABLE messages(id integer,conversation_id text,sender_type text,created_at timestamptz);
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    GRANT SELECT ON conversations,contacts,deals,pipeline_stages,messages TO authenticated;
    ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY c ON conversations FOR SELECT TO authenticated USING(
      account_id=current_setting('app.account') AND
      (current_setting('app.role')='owner' OR assigned_to=auth.uid()));
    CREATE POLICY ct ON contacts FOR SELECT TO authenticated USING(account_id=current_setting('app.account'));
    CREATE POLICY d ON deals FOR SELECT TO authenticated USING(account_id=current_setting('app.account'));
    CREATE POLICY s ON pipeline_stages FOR SELECT TO authenticated USING(account_id=current_setting('app.account'));
    CREATE POLICY m ON messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id));
    INSERT INTO conversations VALUES
      ('one','a','00000000-0000-0000-0000-000000000001','open','2026-10-26'),
      ('two','a','00000000-0000-0000-0000-000000000002','open','2026-10-27'),
      ('outside','b','00000000-0000-0000-0000-000000000001','open','2026-10-27');
    INSERT INTO contacts SELECT n::text,'a','2026-10-27'::timestamptz FROM generate_series(1,1500)n;
    INSERT INTO contacts VALUES('outside','b','2026-10-27');
    INSERT INTO pipeline_stages VALUES('s','a','Open',null,0),('outside','b','Secret',null,0);
    INSERT INTO deals SELECT n::text,'a','s','open',10 FROM generate_series(1,1500)n;
    INSERT INTO deals VALUES('outside','b','outside','open',999999);
    INSERT INTO messages SELECT n,'one','customer','2026-10-27 09:00Z' FROM generate_series(1,1500)n;
    INSERT INTO messages VALUES
      (1501,'one','customer','2026-10-27 09:01Z'),
      (1502,'one','agent','2026-10-27 09:10Z'),
      (1503,'one','bot','2026-10-27 09:11Z'),
      (1504,'one','customer','2026-10-27 10:00Z'),
      (1505,'one','bot','2026-10-27 10:20Z'),
      (1506,'one','customer','2026-10-27 11:00Z'),
      (1507,'one','customer','2026-10-27 23:30Z'),
      (1508,'two','customer','2026-10-27 08:00Z'),
      (1509,'two','agent','2026-10-27 09:00Z'),
      (1510,'outside','customer','2026-10-27 08:00Z'),
      (1511,'outside','agent','2026-10-27 12:00Z');
  `);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/083_dashboard_aggregates.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(`SET ROLE authenticated;
    SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
    SET app.account='a'; SET app.role='owner';`);
  const value = async (sql) =>
    (await db.query(`SELECT ${sql} AS value`)).rows[0].value;
  const metrics = await value(`dashboard_metrics('2026-10-27','2026-10-26')`);
  assert.equal(metrics.newContactsToday.current, 1500);
  assert.equal(metrics.openDealsCount, 1500);
  assert.equal(metrics.openDealsValue, 15000);
  assert.equal(metrics.activeConversations.current, 2);
  assert.equal(metrics.messagesSentToday.current, 2);
  const pipeline = await value('dashboard_pipeline_summary()');
  assert.equal(pipeline.totalValue, 15000);
  assert.equal(pipeline.stages.length, 1);
  assert.equal(pipeline.stages[0].dealCount, 1500);
  const series = await value(`dashboard_message_series('2026-10-27',7,'UTC')`);
  assert.equal(series.length, 7);
  assert.equal(series[0].incoming, 1505);
  assert.equal(series[0].outgoing, 4);
  assert.equal(series[1].incoming, 0);
  const qatar = await value(
    `dashboard_message_series('2026-10-26 21:00Z',7,'Asia/Qatar')`
  );
  assert.equal(qatar[0].day, '2026-10-27');
  assert.equal(qatar[1].incoming, 1);
  const response = await value(
    `dashboard_response_time('2026-10-20','2026-10-26','2026-10-19','UTC')`
  );
  assert.equal(response.thisWeekAvg, 30); // (10 + 20 + 60) / 3, unanswered excluded
  assert.equal(response.lastWeekAvg, null);
  assert.equal(response.buckets[1].samples, 3);
  assert.equal(response.buckets[0].avgMinutes, null);
  await db.exec(`SET app.role='agent'`);
  assert.equal(
    (await value(`dashboard_metrics('2026-10-27','2026-10-26')`))
      .activeConversations.current,
    1
  );
  assert.equal(
    (
      await value(
        `dashboard_response_time('2026-10-20','2026-10-26','2026-10-19','UTC')`
      )
    ).thisWeekAvg,
    15
  );
  await db.exec(`SET app.account='b'; SET app.role='owner'`);
  assert.equal(
    (await value('dashboard_pipeline_summary()')).totalValue,
    999999
  );
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(
    value('dashboard_pipeline_summary()'),
    /permission denied/
  );
  console.log(
    'Dashboard SQL checks passed: >1500 records, counts/sums, zero days, timezone boundary, reply bursts, unanswered messages, tenant/assignment RLS and anonymous denial.'
  );
} finally {
  await db.close();
}
