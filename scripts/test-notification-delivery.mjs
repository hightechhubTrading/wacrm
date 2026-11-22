/** Disposable PostgreSQL; no business-database connections or provider requests.
 * CI: NOTIFICATION_SQL_CONTAINER; hosted fixture: NOTIFICATION_SQL_SSH_KEY/TARGET.
 * Optional single-connection fallback: PGLITE_MODULE.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db =
  process.env.NOTIFICATION_SQL_SSH_KEY || process.env.NOTIFICATION_SQL_CONTAINER
    ? await (
        await import('./notification-postgres-fixture.mjs')
      ).createNotificationPostgresFixture()
    : new (
        await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
      ).PGlite();
try {
  if (!db.fork)
    await db.exec(
      'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;'
    );
  await db.exec(`
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE accounts(id uuid PRIMARY KEY);
 CREATE TABLE profiles(user_id uuid PRIMARY KEY,account_id uuid,account_role text,id uuid DEFAULT gen_random_uuid());
 CREATE FUNCTION is_account_member(a uuid,role text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=auth.uid() AND p.account_id=a AND (role='viewer' OR p.account_role IN ('agent','admin','owner'))) $$;
 CREATE TABLE contacts(id uuid PRIMARY KEY,account_id uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,contact_id uuid,assigned_agent_id uuid,
 status text DEFAULT 'open', ai_autoreply_disabled boolean DEFAULT false,ai_handoff_summary text,ai_handoff_reason jsonb,ai_priority text,ai_priority_reason text);
 CREATE TABLE ai_configs(account_id uuid PRIMARY KEY,last_key_error text);
 CREATE TABLE ai_reply_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid,conversation_id uuid,trigger_message_id text,outcome text,reason text,details jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
 CREATE TABLE ai_media_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid,conversation_id uuid,trigger_message_id text,file_id uuid,status text,failure_code text);
 CREATE TABLE quotations(id uuid PRIMARY KEY,account_id uuid,assigned_to uuid,reference text,status text,archived_at timestamptz);
 CREATE TABLE quotation_sales_notes(quotation_id uuid,account_id uuid,version integer,follow_up_date date);
 CREATE TABLE job_appointments(id uuid PRIMARY KEY,account_id uuid,responsible_profile_id uuid,revision integer DEFAULT 0,kind text,status text,starts_at timestamptz,ends_at timestamptz);

 CREATE TABLE ai_followups(id uuid PRIMARY KEY, account_id uuid, conversation_id uuid, due_at timestamptz DEFAULT now(), status text DEFAULT 'open',created_at timestamptz DEFAULT now());
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,sender_type text,created_at timestamptz DEFAULT now(),ai_generated boolean DEFAULT false);
 CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid,user_id uuid,conversation_id uuid,
 contact_id uuid,actor_user_id uuid,type text CHECK(type IN ('conversation_assigned','ai_key_invalid','urgent_lead','ai_handoff')),
 title text,body text,read_at timestamptz,created_at timestamptz DEFAULT now());
 ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
 CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
 GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
 GRANT SELECT ON profiles,conversations,notifications,quotations,job_appointments TO authenticated;
 GRANT UPDATE(read_at) ON notifications TO authenticated;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
 CREATE FUNCTION notify_conversation_assigned() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TRIGGER on_conversation_assigned AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();
`);
  for (const file of [
    '100_mobile_push.sql',
    '101_notification_center.sql',
    '102_notification_delivery.sql',
    '104_notification_operations.sql',
    '105_notification_ack_locking.sql',
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const ids = Array.from(
    { length: 8 },
    (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  );
  const [account, user, admin, other, conversation, contact, task, device] =
    ids;
  await db.exec(`INSERT INTO accounts VALUES('${account}');
 INSERT INTO auth.users(id) VALUES('${user}'),('${admin}'),('${other}');
 INSERT INTO profiles VALUES('${user}','${account}','agent'),('${admin}','${account}','admin');
 INSERT INTO contacts VALUES('${contact}','${account}');
 INSERT INTO conversations(id,account_id,contact_id) VALUES('${conversation}','${account}','${contact}');
 INSERT INTO ai_followups(id,account_id,conversation_id) VALUES('${task}','${account}','${conversation}');`);
  const count = async (table) =>
    Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
  await db.exec(
    `UPDATE conversations SET assigned_agent_id='${user}',ai_autoreply_disabled=true,ai_handoff_summary='Needs a person' WHERE id='${conversation}';`
  );
  assert.equal(
    await count('notification_events'),
    1,
    'handoff+assignment is one event'
  );
  assert.equal(await count('notifications'), 0, 'event survives before fanout');
  await db.exec(
    `INSERT INTO notifications(account_id,user_id,type,conversation_id,title,body) VALUES('${account}','${user}','ai_handoff','${conversation}','AI handoff','duplicate helper');`
  );
  assert.equal(
    await count('notification_events'),
    1,
    'explicit helper deduplicates with source trigger'
  );
  await db.exec(
    'SELECT drain_notification_events(); SELECT drain_notification_events();'
  );
  assert.equal(
    await count('notifications'),
    1,
    'repeat fanout does not duplicate'
  );
  await db.exec(
    `UPDATE conversations SET ai_autoreply_disabled=false WHERE id='${conversation}'; UPDATE conversations SET ai_autoreply_disabled=true WHERE id='${conversation}'; SELECT drain_notification_events();`
  );
  assert.equal(
    await count('notifications'),
    2,
    'new handoff episode still alerts'
  );
  await db.exec(
    `BEGIN; UPDATE conversations SET ai_handoff_summary='rolled back' WHERE id='${conversation}'; ROLLBACK;`
  );
  assert.equal(
    await count('notification_events'),
    2,
    'rolled-back source leaves no intent'
  );
  await db.exec(
    `UPDATE conversations SET ai_handoff_summary='new source event' WHERE id='${conversation}'; UPDATE conversations SET assigned_agent_id='${admin}' WHERE id='${conversation}'; SELECT drain_notification_events();`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE user_id='${user}'`
      )
    ).rows[0].n,
    2,
    'old owner not alerted after reassignment'
  );
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false); SELECT set_notification_categories('${account}',ARRAY['followups']);`
  );
  assert.deepEqual(
    (await db.query('SELECT push_categories FROM notification_preferences'))
      .rows[0].push_categories,
    ['followups']
  );
  await db.exec(
    `SELECT set_notification_categories('${account}',ARRAY['system']); RESET ROLE;`
  );
  assert.deepEqual(
    (await db.query('SELECT push_categories FROM notification_preferences'))
      .rows[0].push_categories,
    ['system'],
    'RPC updates only permitted column'
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_table_privilege('authenticated','notification_events','SELECT') allowed"
      )
    ).rows[0].allowed,
    false,
    'event payloads private'
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('authenticated','drain_notification_events(integer)','EXECUTE') allowed"
      )
    ).rows[0].allowed,
    false,
    'clients cannot drain'
  );

  const eventCount = await count('notification_events');
  await db.exec(
    `UPDATE conversations SET ai_priority='urgent' WHERE id='${conversation}'; UPDATE conversations SET ai_priority_reason='same episode' WHERE id='${conversation}';`
  );
  assert.equal(
    await count('notification_events'),
    eventCount + 1,
    'urgency state transition records one event'
  );
  await db.exec(
    `INSERT INTO notifications(account_id,user_id,type,conversation_id,title) VALUES('${account}','${admin}','urgent_lead','${conversation}','duplicate urgency helper');`
  );
  assert.equal(
    await count('notification_events'),
    eventCount + 1,
    'urgency helper deduplicates'
  );
  await db.exec(
    `INSERT INTO ai_configs(account_id) VALUES('${account}'); UPDATE ai_configs SET last_key_error='bad key' WHERE account_id='${account}'; UPDATE ai_configs SET last_key_error='still bad' WHERE account_id='${account}';`
  );
  assert.equal(
    await count('notification_events'),
    eventCount + 2,
    'key errors alert once per failure episode'
  );
  await db.exec(
    `UPDATE ai_configs SET last_key_error=NULL WHERE account_id='${account}'; UPDATE ai_configs SET last_key_error='bad again' WHERE account_id='${account}';`
  );
  assert.equal(
    await count('notification_events'),
    eventCount + 3,
    'key recovery permits another episode'
  );
  await db.exec(`INSERT INTO notifications(account_id,user_id,type,conversation_id,followup_id,title) VALUES('${account}','${admin}','followup_due','${conversation}','${task}','Follow-up');
 INSERT INTO notifications(account_id,user_id,type,conversation_id,followup_id,title) VALUES('${account}','${admin}','followup_due','${conversation}','${task}','Follow-up retry');`);
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notification_events WHERE followup_id='${task}'`
      )
    ).rows[0].n,
    1,
    'same due revision/day is one reminder'
  );
  await db.exec(
    `UPDATE ai_followups SET status='completed' WHERE id='${task}'; SELECT drain_notification_events();`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE followup_id='${task}'`
      )
    ).rows[0].n,
    0,
    'completion cancels undelivered reminder'
  );
  await db.exec(`UPDATE ai_followups SET status='deferred',due_at=now()-interval '1 minute' WHERE id='${task}';
 INSERT INTO notifications(account_id,user_id,type,conversation_id,followup_id,title) VALUES('${account}','${admin}','followup_due','${conversation}','${task}','Follow-up rescheduled'); SELECT drain_notification_events();`);
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE followup_id='${task}'`
      )
    ).rows[0].n,
    1,
    'rescheduled due revision produces a new reminder'
  );
  await db.exec(
    `UPDATE ai_followups SET status='completed' WHERE id='${task}';`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE followup_id='${task}' AND resolved_at IS NOT NULL`
      )
    ).rows[0].n,
    1,
    'completion resolves delivered reminder'
  );
  // Inject a delivery failure after staging; retry must preserve the event and avoid duplicates.
  await db.exec(`INSERT INTO notifications(account_id,user_id,type,title) VALUES('${account}','${admin}','reply_review_required','fault injection');
 CREATE FUNCTION injected_notification_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id IS NOT NULL AND NEW.title='fault injection' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER a_injected_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION injected_notification_failure();
 SELECT drain_notification_events();`);
  assert.equal(
    (
      await db.query(
        `SELECT attempts FROM notification_events WHERE title='fault injection'`
      )
    ).rows[0].attempts,
    1,
    'failed fanout retains retryable intent'
  );
  await db.exec(
    `DROP TRIGGER a_injected_failure ON notifications; UPDATE notification_events SET available_at=now() WHERE title='fault injection'; SELECT drain_notification_events(); SELECT drain_notification_events();`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE title='fault injection'`
      )
    ).rows[0].n,
    1,
    'recovered event delivered once'
  );
  assert.equal(
    (await db.query('SELECT notification_delivery_ready() ready')).rows[0]
      .ready,
    true,
    'deployment sentinel is ready'
  );
  // Category policy rejects both new queue entries and leased work after a preference change.
  await db.exec(`UPDATE conversations SET assigned_agent_id='${user}' WHERE id='${conversation}'; INSERT INTO messages(id,conversation_id,sender_type) VALUES('${task}','${conversation}','customer'); INSERT INTO auth.sessions(id,user_id) VALUES('${device}','${user}');
 INSERT INTO mobile_push_devices(id,account_id,user_id,session_id,secret_hash,rotation_hash,token_hash,token_ciphertext,project_id,app_id,environment)
 VALUES('${device}','${account}','${user}','${device}',repeat('a',64),repeat('b',64),repeat('c',64),'synthetic','test-project','com.hightechhub.crm.demo','development');`);
  assert.equal(
    (
      await db.query(
        `SELECT notification_push_allowed('${device}','message','${task}') allowed`
      )
    ).rows[0].allowed,
    false,
    'muted assignments suppress message push'
  );
  await db.exec(
    `INSERT INTO mobile_push_jobs(device_id,account_id,source_id,kind) VALUES('${device}','${account}','${task}','message');`
  );
  assert.equal(
    await count('mobile_push_jobs'),
    0,
    'suppressed category does not enqueue'
  );
  await db.exec(`UPDATE notification_preferences SET push_categories=ARRAY['assignments'] WHERE user_id='${user}';
 INSERT INTO mobile_push_jobs(device_id,account_id,source_id,kind) VALUES('${device}','${account}','${task}','message');
 UPDATE mobile_push_jobs SET state='leased',lease_token='${task}',lease_until=now()+interval '1 minute';
 UPDATE notification_preferences SET push_categories=ARRAY[]::text[] WHERE user_id='${user}';`);
  assert.equal(
    (
      await db.query(
        `SELECT * FROM prepare_mobile_push_job((SELECT id FROM mobile_push_jobs),'${task}')`
      )
    ).rows.length,
    0,
    'new preference suppresses already leased work'
  );
  assert.equal(
    (await db.query('SELECT state FROM mobile_push_jobs')).rows[0].state,
    'discarded'
  );

  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${other}',false);`
  );
  assert.equal(
    (await db.query('SELECT * FROM notification_preferences')).rows.length,
    0,
    'nonmember cannot read preferences'
  );
  await assert.rejects(
    db.exec(`SELECT set_notification_categories('${account}',ARRAY['system'])`),
    /row-level security|42501/
  );
  await db.exec('RESET ROLE;');
  const revision = (
    await db.query(
      `SELECT notification_handoff_revision FROM conversations WHERE id='${conversation}'`
    )
  ).rows[0].notification_handoff_revision;
  await db.exec(
    `UPDATE conversations SET notification_handoff_revision=gen_random_uuid() WHERE id='${conversation}'`
  );
  assert.equal(
    (
      await db.query(
        `SELECT notification_handoff_revision FROM conversations WHERE id='${conversation}'`
      )
    ).rows[0].notification_handoff_revision,
    revision,
    'clients cannot forge episode identifiers'
  );

  assert.equal(
    (await db.query('SELECT notification_operations_ready() ready')).rows[0]
      .ready,
    true,
    'operational schema ready'
  );
  await db.exec(
    `INSERT INTO ai_reply_events(account_id,conversation_id,trigger_message_id,outcome,reason) VALUES('${account}','${conversation}','synthetic-review-source','failed','unverified_price');`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notification_events WHERE source_key LIKE 'review:synthetic-review-source:%'`
      )
    ).rows[0].n,
    1,
    'review source commits durable intent before helper'
  );
  await db.exec(
    `INSERT INTO notifications(account_id,user_id,conversation_id,type,title,source_key) VALUES('${account}','${user}','${conversation}','reply_review_required','duplicate review helper','review:synthetic-review-source:reply_review_required:unverified_price');`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notification_events WHERE source_key LIKE 'review:synthetic-review-source:%'`
      )
    ).rows[0].n,
    1,
    'review retries deduplicate'
  );

  const beforeIgnored = await count('notification_events');
  await db.exec(
    `INSERT INTO ai_reply_events(account_id,conversation_id,trigger_message_id,outcome,reason) VALUES('${account}','${conversation}','ignored-source','failed','slot_unavailable');`
  );
  assert.equal(
    await count('notification_events'),
    beforeIgnored,
    'unrelated failed slots do not become review alerts'
  );
  await db.exec(`INSERT INTO ai_media_actions(id,account_id,conversation_id,trigger_message_id,file_id,status) VALUES('${contact}','${account}','${conversation}','media-source','${contact}','sending'); UPDATE ai_media_actions SET status='uncertain',failure_code='interrupted_transport' WHERE id='${contact}';
   INSERT INTO notifications(account_id,user_id,conversation_id,type,title,source_key) VALUES('${account}','${user}','${conversation}','media_review_required','explicit media helper','media:${account}:${conversation}:media-source:${contact}'); SELECT drain_notification_events();`);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM notification_events WHERE source_key LIKE 'media:%'"
      )
    ).rows[0].n,
    1,
    'source media state and explicit helper deduplicate'
  );
  await db.exec(
    `UPDATE ai_media_actions SET status='accepted' WHERE id='${contact}';`
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM notifications WHERE source_key LIKE 'media:%' AND resolved_at IS NOT NULL"
      )
    ).rows[0].n,
    1,
    'accepted attachment resolves its review notice'
  );
  const quote = '00000000-0000-0000-0000-000000000051',
    appointment = '00000000-0000-0000-0000-000000000052';
  await db.exec(`INSERT INTO quotations(id,account_id,assigned_to,reference,status) SELECT '${quote}','${account}',id,'SYN-Q-1','sent' FROM profiles WHERE user_id='${user}';
    INSERT INTO quotation_sales_notes VALUES('${quote}','${account}',1,(now() AT TIME ZONE 'Asia/Qatar')::date);
    INSERT INTO job_appointments(id,account_id,responsible_profile_id,kind,status,starts_at,ends_at) SELECT '${appointment}','${account}',id,'visit','reserved',now()+interval '30 minutes',now()+interval '1 hour' FROM profiles WHERE user_id='${user}';
    SELECT maintain_notifications(); SELECT maintain_notifications();`);
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notification_events WHERE target_kind='quotation'`
      )
    ).rows[0].n,
    1,
    'quotation reminder once per due revision/day'
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notification_events WHERE target_kind='appointment'`
      )
    ).rows[0].n,
    2,
    'booking change and upcoming reminder recorded once'
  );
  await db.exec(
    `UPDATE job_appointments SET revision=revision+1,starts_at=now()+interval '2 hours',ends_at=now()+interval '3 hours' WHERE id='${appointment}'; SELECT maintain_notifications();`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE target_kind='appointment' AND resolved_at IS NOT NULL`
      )
    ).rows[0].n,
    2,
    'reschedule resolves old appointment notices'
  );
  await db.exec(
    `UPDATE quotation_sales_notes SET follow_up_date=NULL,version=2 WHERE quotation_id='${quote}';`
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notifications WHERE target_kind='quotation' AND resolved_at IS NOT NULL`
      )
    ).rows[0].n,
    1,
    'removed follow-up resolves old quotation notice'
  );
  // Acknowledged work does not escalate; read-only work still does, once.
  await db.exec(`UPDATE notification_events SET acknowledged_at=now(); UPDATE notification_account_policy SET escalation_enabled=true,activated_at=now()-interval '1 day' WHERE account_id='${account}';
   INSERT INTO notification_events(account_id,user_id,event_key,type,conversation_id,title,created_at) VALUES('${account}','${user}','synthetic-sla','ai_handoff','${conversation}','SLA fixture',now()-interval '20 minutes');
   SELECT maintain_notifications(); SELECT maintain_notifications();`);
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM notification_events WHERE type='escalation'`
      )
    ).rows[0].n,
    1,
    'unacknowledged high priority escalates once'
  );
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false); SELECT acknowledge_notification((SELECT id FROM notifications WHERE title='SLA fixture')); RESET ROLE;`
  );
  assert.equal(
    (
      await db.query(
        `SELECT acknowledged_at IS NOT NULL acknowledged FROM notification_events WHERE event_key='synthetic-sla'`
      )
    ).rows[0].acknowledged,
    true,
    'explicit acknowledgment reaches source event'
  );

  await db.exec(
    `INSERT INTO mobile_push_preferences(user_id,account_id,enabled) VALUES('${user}','${account}',false) ON CONFLICT(user_id,account_id) DO UPDATE SET enabled=false; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false); SELECT set_notification_channel_policy('${account}',true,false,false,1320,420,'Asia/Qatar'); RESET ROLE;`
  );
  const quiet = (
    await db.query(
      `SELECT enabled,quiet_start,quiet_end FROM mobile_push_preferences WHERE user_id='${user}'`
    )
  ).rows[0];
  assert.equal(quiet.enabled, false, 'quiet-hour edits preserve push opt-out');
  assert.equal(quiet.quiet_start, 1320);
  assert.equal(quiet.quiet_end, 420);
  if (db.fork) {
    const sibling = db.fork();
    try {
      await db.exec(
        `INSERT INTO notification_events(account_id,user_id,event_key,type,title) VALUES('${account}','${user}','concurrency-a','conversation_assigned','Concurrency fixture'),('${account}','${user}','concurrency-b','conversation_assigned','Concurrency fixture'); BEGIN; SELECT id FROM notification_events WHERE event_key='concurrency-a' FOR UPDATE;`
      );
      await sibling.exec('SELECT drain_notification_events(100);');
      await db.exec('COMMIT;');
      await sibling.exec('SELECT drain_notification_events(100);');
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM notifications WHERE title='Concurrency fixture'"
          )
        ).rows[0].n,
        2,
        'independent drains skip locked work and deliver each event once'
      );
      const notice = (
        await db.query(
          "SELECT id FROM notifications WHERE event_id=(SELECT id FROM notification_events WHERE event_key='concurrency-a')"
        )
      ).rows[0].id;
      await db.exec(
        "BEGIN; SELECT id FROM notification_events WHERE event_key='concurrency-a' FOR UPDATE;"
      );
      await sibling.exec(
        `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`
      );
      await assert.rejects(
        sibling.exec(`SELECT acknowledge_notification('${notice}')`),
        /55P03/
      );
      await db.exec('COMMIT;');
      await sibling.exec(`SELECT acknowledge_notification('${notice}');`);
      assert.equal(
        (
          await db.query(
            "SELECT acknowledged_at IS NOT NULL ack FROM notification_events WHERE event_key='concurrency-a'"
          )
        ).rows[0].ack,
        true,
        'ack retry succeeds after event lock is released'
      );
    } finally {
      await sibling.close();
    }
  }
  console.log(
    'PASS isolated notification migrations, source recovery, reminder resolution, escalation, two-connection locking, routing, preferences and privilege checks'
  );
} finally {
  await db.close();
}
