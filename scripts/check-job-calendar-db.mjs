/** Disposable PostgreSQL tests of the actual handoff + calendar migrations. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const moduleUrl = process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href
  : '@electric-sql/pglite';
const { PGlite } = await import(moduleUrl);
const { btree_gist } = await import(
  process.env.PGLITE_MODULE
    ? new URL('./contrib/btree_gist.js', moduleUrl).href
    : '@electric-sql/pglite/contrib/btree_gist'
);
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = id(1),
  other = id(2),
  admin = id(11),
  agent = id(12),
  otherAgent = id(13),
  viewer = id(14),
  foreign = id(15);
const actor = id(21),
  agentActor = id(22),
  otherActor = id(23),
  viewerActor = id(24),
  foreignActor = id(25);
const deal = (n) => id(100 + n);
const at = (hour) => `2035-01-02T${String(hour).padStart(2, '0')}:00:00Z`;
const query = (sql, params = []) => db.query(sql, params);
async function create(d, start, end, options = {}) {
  return (
    await query(
      `SELECT create_scheduled_group_handoff($1,$2,$3,$4,'Customer site','Measure two window openings',$5,$6,$7,$8) result`,
      [
        options.account ?? account,
        d,
        options.actor ?? actor,
        options.kind ?? 'measurement',
        options.person ?? admin,
        start,
        end,
        options.quote ?? null,
      ]
    )
  ).rows[0].result;
}
async function move(work, revision, start, end) {
  return (
    await query('SELECT save_job_appointment($1,$2,$3,$4,$5,$6,$7,$8) result', [
      account,
      work.deal,
      work.id,
      actor,
      agent,
      start,
      end,
      revision,
    ])
  ).rows[0].result;
}
async function booking(work) {
  return (
    await query('SELECT * FROM job_appointments WHERE handoff_id=$1', [work])
  ).rows[0];
}
async function change(work, revision, action, status) {
  return query(
    "SELECT record_group_handoff_event($1,$2,$3,$4,$5,$6,$7,'Recorded with supporting explanation','[]')",
    [account, work.deal, work.id, revision, actor, action, status]
  );
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE accounts(id uuid PRIMARY KEY);
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,account_id uuid,account_role text,full_name text);
    CREATE TABLE deals(id uuid PRIMARY KEY,account_id uuid,assigned_to uuid);
    CREATE TABLE quotations(id uuid PRIMARY KEY,account_id uuid,deal_id uuid,status text,reference text,revision integer,assigned_to uuid);
    CREATE TABLE quotation_items(quotation_id uuid,item_type text,description text,description_ar text,size_w numeric,size_h numeric,qty numeric,position integer);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION is_account_member(a uuid,min_role text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS(SELECT 1 FROM profiles WHERE account_id=a AND user_id=auth.uid() AND
        CASE account_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END >=
        CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END)$$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    GRANT SELECT ON deals,profiles TO authenticated;
    ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY deals_select ON deals FOR SELECT TO authenticated USING (
      is_account_member(account_id,'admin') OR (is_account_member(account_id,'agent') AND assigned_to=(SELECT id FROM profiles WHERE user_id=auth.uid()))
    );
    INSERT INTO accounts VALUES('${account}'),('${other}');
    INSERT INTO auth.users VALUES('${actor}'),('${agentActor}'),('${otherActor}'),('${viewerActor}'),('${foreignActor}');
    INSERT INTO profiles VALUES
      ('${admin}','${actor}','${account}','owner','Requester'),
      ('${agent}','${agentActor}','${account}','agent','Sales A'),
      ('${otherAgent}','${otherActor}','${account}','agent','Sales B'),
      ('${viewer}','${viewerActor}','${account}','viewer','Viewer'),
      ('${foreign}','${foreignActor}','${other}','owner','Other company');
    INSERT INTO deals VALUES ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `('${deal(n)}','${n === 9 ? other : account}','${n === 9 ? foreign : n === 3 ? otherAgent : agent}')`).join(',')};
    INSERT INTO quotations VALUES('${id(301)}','${account}','${deal(1)}','won','WS-35-1',2,'${admin}');
    INSERT INTO quotation_items VALUES('${id(301)}','line','Five shutters',NULL,2,3,5,0);
  `);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/070_group_handoffs.sql', import.meta.url),
      'utf8'
    )
  );
  await query(
    `INSERT INTO group_handoffs(account_id,deal_id,created_by,kind,location,details,due_at) VALUES($1,$2,$3,'measurement','Old site','Previously prepared request','2034-01-02T10:00Z')`,
    [account, deal(8), actor]
  );
  const legacy = (
    await query('SELECT id FROM group_handoffs WHERE deal_id=$1', [deal(8)])
  ).rows[0].id;
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/097_company_job_calendar.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  assert.equal(
    (await query('SELECT job_calendar_ready() ready')).rows[0].ready,
    true
  );
  assert.equal(
    (await query('SELECT count(*)::int n FROM job_appointments')).rows[0].n,
    0,
    'Do not fabricate bookings from historical requested dates'
  );
  const first = await create(deal(1), at(8), at(9));
  const second = await create(deal(2), at(9), at(10), { person: agent });
  assert.ok(first.id && second.id, 'Adjacent reservations must work');
  await assert.rejects(
    create(deal(3), '2035-01-02T08:30Z', '2035-01-02T09:30Z', {
      actor: otherActor,
      person: otherAgent,
    }),
    (error) => error.code === '23P01'
  );
  assert.equal(
    (
      await query(
        'SELECT count(*)::int n FROM group_handoffs WHERE deal_id=$1',
        [deal(3)]
      )
    ).rows[0].n,
    0,
    'A conflict must not leave a partial work request'
  );
  await create(deal(9), at(8), at(9), {
    account: other,
    actor: foreignActor,
    person: foreign,
  });
  await assert.rejects(
    create(deal(3), at(10), at(11), { person: foreign }),
    /current CRM member/
  );
  await assert.rejects(
    create(deal(3), at(10), at(11), { person: viewer }),
    /current CRM member/
  );
  await assert.rejects(
    create(deal(9), at(10), at(11)),
    (error) => error.code === '42501'
  );
  await assert.rejects(
    create(deal(3), at(10), at(11), { actor: agentActor }),
    (error) => error.code === '42501'
  );
  await assert.rejects(
    create(deal(3), at(10), at(11), { actor: viewerActor }),
    (error) => error.code === '42501'
  );
  await assert.rejects(
    create(deal(1), at(14), at(16), {
      actor: agentActor,
      person: agent,
      kind: 'workshop',
      quote: id(301),
    }),
    /accepted quotation/
  );
  await assert.rejects(
    create(deal(3), at(11), at(10)),
    (error) => error.code === '23514' || error.code === '22000'
  );
  const races = await Promise.allSettled([
    create(deal(4), at(12), at(13)),
    create(deal(5), at(12), at(13)),
  ]);
  assert.equal(races.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    races.filter((x) => x.status === 'rejected' && x.reason.code === '23P01')
      .length,
    1
  );
  const secondWork = { id: second.id, deal: deal(2) };
  await assert.rejects(
    move(secondWork, 0, at(8), at(9)),
    (error) => error.code === '23P01'
  );
  assert.equal(
    new Date((await booking(second.id)).starts_at).toISOString(),
    new Date(at(9)).toISOString()
  );
  assert.ok(await move(secondWork, 0, at(10), at(11)));
  assert.equal(
    await move(secondWork, 0, at(11), at(12)),
    null,
    'Stale calendar edits must not move bookings'
  );
  await assert.rejects(
    create(deal(1), at(14), at(16), { kind: 'workshop' }),
    /accepted quotation/
  );
  const workshop = await create(deal(1), at(14), at(16), {
    kind: 'workshop',
    quote: id(301),
  });
  assert.equal((await booking(workshop.id)).kind, 'installation');
  await query('UPDATE quotations SET revision=3 WHERE id=$1', [id(301)]);
  const snapshot = (
    await query('SELECT quotation_snapshot FROM group_handoffs WHERE id=$1', [
      workshop.id,
    ])
  ).rows[0].quotation_snapshot;
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.items[0].qty, 5);
  await move({ id: legacy, deal: deal(8) }, null, at(17), at(18));
  assert.equal((await booking(legacy)).responsible_profile_id, agent);
  const firstWork = { id: first.id, deal: deal(1) };
  await change(firstWork, 0, 'posted', 'waiting');
  await change(firstWork, 1, 'report', 'report_received');
  assert.equal((await booking(first.id)).status, 'completed');
  await change({ id: workshop.id, deal: deal(1) }, 0, 'cancelled', 'cancelled');
  assert.equal((await booking(workshop.id)).status, 'cancelled');
  await create(deal(6), at(14), at(16));
  const departedWork = await create(deal(3), at(19), at(20), {
    actor: otherActor,
    person: otherAgent,
  });
  await query('DELETE FROM profiles WHERE id=$1', [otherAgent]);
  const departed = (
    await query(
      'SELECT responsible_profile_id,responsible_name FROM job_appointments WHERE deal_id=$1',
      [deal(3)]
    )
  ).rows[0];
  assert.equal(departed.responsible_profile_id, null);
  assert.equal(departed.responsible_name, 'Sales B');
  await assert.rejects(
    create(deal(7), at(19), at(20)),
    (error) => error.code === '23P01'
  );
  await move({ id: departedWork.id, deal: deal(3) }, 0, at(20), at(21));
  assert.equal((await booking(departedWork.id)).responsible_profile_id, agent);
  assert.equal(
    (
      await query('SELECT created_by FROM group_handoffs WHERE id=$1', [
        departedWork.id,
      ])
    ).rows[0].created_by,
    otherActor
  );
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${agentActor}',false);`
  );
  const visible = (
    await query('SELECT deal_id FROM job_appointments')
  ).rows.map((r) => r.deal_id);
  assert.ok(visible.includes(deal(1)));
  assert.ok(!visible.includes(deal(9)));
  assert.ok(!visible.includes(deal(3)));
  await assert.rejects(
    query(
      "SELECT create_scheduled_group_handoff($1,$2,$3,'measurement','Site','Measure the windows',$4,$5,$6,NULL)",
      [account, deal(7), actor, admin, at(19), at(20)]
    ),
    /permission denied/
  );
  await assert.rejects(
    query("UPDATE job_appointments SET status='cancelled'"),
    /permission denied/
  );
  await db.exec('RESET ROLE;');
  console.log(
    'Company calendar database checks passed: shared-capacity conflicts, adjacent slots, competing requests, atomic rollback, cross-account/member/RLS boundaries, accepted quotation snapshots, rescheduling/stale edits, historical booking and lifecycle release.'
  );
} finally {
  await db.close();
}
