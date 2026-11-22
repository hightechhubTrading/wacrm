-- Isolated fixture only: minimal schemas, no real CRM records or provider sends.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,not_after timestamptz);
CREATE TABLE accounts(id uuid PRIMARY KEY);
CREATE TABLE profiles(user_id uuid PRIMARY KEY REFERENCES auth.users(id),account_id uuid REFERENCES accounts(id),account_role text);
CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id),assigned_agent_id uuid,unread_count integer DEFAULT 1);
CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),sender_type text);
CREATE TABLE notifications(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id),user_id uuid,conversation_id uuid,read_at timestamptz,created_at timestamptz DEFAULT now());
CREATE FUNCTION test_assert(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Push assertion failed: %',label; END IF; END $$;

-- The runner inserts the actual migration here, before the statements below.
-- MIGRATION

SELECT test_assert(mobile_push_ready(),'readiness sentinel');
GRANT SELECT ON mobile_push_devices TO authenticated;
SELECT test_assert(NOT mobile_push_ready(),'readiness detects leaked client privilege');
REVOKE SELECT ON mobile_push_devices FROM authenticated;
ALTER TABLE mobile_push_devices DISABLE ROW LEVEL SECURITY;
SELECT test_assert(NOT mobile_push_ready(),'readiness detects missing RLS');
ALTER TABLE mobile_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE TRIGGER mobile_push_message;
SELECT test_assert(NOT mobile_push_ready(),'readiness detects disabled source trigger');
ALTER TABLE messages ENABLE TRIGGER mobile_push_message;
SELECT test_assert(mobile_push_ready(),'readiness restored');

INSERT INTO accounts VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000011'),('00000000-0000-0000-0000-000000000012'),('00000000-0000-0000-0000-000000000013'),('00000000-0000-0000-0000-000000000014');
INSERT INTO profiles VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','agent'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','admin'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','viewer'),
 ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000002','agent');
INSERT INTO auth.sessions SELECT gen_random_uuid(),id FROM auth.users;
INSERT INTO conversations VALUES('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',1);

DO $$
DECLARE u profiles; sid uuid; device uuid; ok boolean;
BEGIN
  FOR u IN SELECT * FROM profiles LOOP
    SELECT id INTO sid FROM auth.sessions WHERE user_id=u.user_id;
    device:=('00000000-0000-0000-0000-'||lpad((right(u.user_id::text,2)::integer+20)::text,12,'0'))::uuid;
    ok:=register_mobile_push_device(device,u.account_id,u.user_id,sid,repeat('a',64),md5(device::text)||md5(device::text),
      'synthetic-encrypted-token','test-project','com.hightechhub.crm.demo','development');
    PERFORM test_assert(ok=(u.account_role<>'viewer'),'viewer denied; other roles register');
  END LOOP;
  PERFORM test_assert(NOT register_mobile_push_device(gen_random_uuid(),'00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000011',sid,repeat('a',64),repeat('b',64),'fake','test-project','com.hightechhub.crm.demo','development'),
    'cross-account registration denied');
  PERFORM test_assert(NOT register_mobile_push_device(gen_random_uuid(),'00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000011',sid,repeat('a',64),repeat('b',64),'fake','test-project','com.hightechhub.crm.demo','development'),
    'another users session denied');
END $$;
DO $$ DECLARE d mobile_push_devices; ids uuid[]:='{}'; next_id uuid; BEGIN
  SELECT * INTO d FROM mobile_push_devices WHERE user_id='00000000-0000-0000-0000-000000000011';
  FOR i IN 1..4 LOOP
    next_id:=gen_random_uuid(); ids:=array_append(ids,next_id);
    PERFORM test_assert(register_mobile_push_device(next_id,d.account_id,d.user_id,d.session_id,d.secret_hash,
      md5(next_id::text)||md5(next_id::text),'fake',d.project_id,d.app_id,d.environment),'five devices supported');
  END LOOP;
  PERFORM test_assert(NOT register_mobile_push_device(gen_random_uuid(),d.account_id,d.user_id,d.session_id,d.secret_hash,
    repeat('e',64),'fake',d.project_id,d.app_id,d.environment),'sixth active device denied');
  FOREACH next_id IN ARRAY ids LOOP PERFORM revoke_mobile_push_device(next_id,d.secret_hash); END LOOP;
END $$;
INSERT INTO messages VALUES('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000021','customer');
INSERT INTO messages VALUES('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000021','agent');
INSERT INTO notifications VALUES('00000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000021',NULL);
SELECT test_assert((SELECT count(*)=2 FROM mobile_push_jobs),'only assigned agent and account admin; outgoing excluded');
INSERT INTO mobile_push_jobs(device_id,account_id,conversation_id,source_id,kind)
 SELECT device_id,account_id,conversation_id,source_id,kind FROM mobile_push_jobs ON CONFLICT DO NOTHING;
SELECT test_assert((SELECT count(*)=2 FROM mobile_push_jobs),'source/device deduplication');
-- Deleting one queued row simulates a failed fanout. Claim must reconstruct it
-- from committed source data; a subsequent claim must not duplicate it.
DELETE FROM mobile_push_jobs WHERE id=(SELECT id FROM mobile_push_jobs LIMIT 1);
SELECT test_assert((SELECT count(*)=0 FROM claim_mobile_push_jobs('wrong-project','development','com.hightechhub.crm.demo',20)),'project scope');
SELECT test_assert((SELECT count(*)=0 FROM claim_mobile_push_jobs('test-project','production','com.hightechhub.crm.demo',20)),'environment scope');
CREATE TEMP TABLE first_claim AS SELECT * FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',1);
SELECT test_assert((SELECT count(*)=2 FROM mobile_push_jobs),'source recovery reconstructs missing fanout');
SELECT test_assert((SELECT count(*)=1 FROM first_claim),'one bounded lease');
SELECT test_assert((SELECT count(*)=1 FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20)),'leased job not reclaimed');
SELECT test_assert((SELECT count(*)=0 FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20)),'active leases excluded');
SELECT test_assert((SELECT count(*)=1 FROM prepare_mobile_push_job((SELECT id FROM first_claim),(SELECT lease_token FROM first_claim))),'eligible preparation');
SELECT test_assert(NOT finish_mobile_push_job((SELECT id FROM first_claim),gen_random_uuid(),'accepted'),'stale lease completion denied');
UPDATE conversations SET assigned_agent_id=NULL;
DO $$ DECLARE j mobile_push_jobs; prepared integer; BEGIN
  FOR j IN SELECT q.* FROM mobile_push_jobs q JOIN mobile_push_devices d ON d.id=q.device_id
    WHERE d.user_id='00000000-0000-0000-0000-000000000011' LOOP
    SELECT count(*) INTO prepared FROM prepare_mobile_push_job(j.id,j.lease_token);
    PERFORM test_assert(prepared=0,'reassignment prevents delivery');
    PERFORM test_assert((SELECT state='discarded' FROM mobile_push_jobs WHERE id=j.id),'unauthorized job discarded');
  END LOOP;
END $$;
UPDATE conversations SET assigned_agent_id='00000000-0000-0000-0000-000000000011';
UPDATE mobile_push_jobs SET state='pending',lease_token=NULL,lease_until=NULL,attempts=0;

DO $$ DECLARE d mobile_push_devices; j mobile_push_jobs; scenario text; prepared integer; BEGIN
  SELECT * INTO d FROM mobile_push_devices WHERE user_id='00000000-0000-0000-0000-000000000011';
  PERFORM test_assert(NOT register_mobile_push_device(d.id,d.account_id,d.user_id,d.session_id,repeat('c',64),d.token_hash,'fake',
    d.project_id,d.app_id,d.environment),'binding cannot be overwritten without its secret');
  FOREACH scenario IN ARRAY ARRAY['expired','banned','deleted','viewer','account'] LOOP
    UPDATE auth.sessions SET not_after=NULL;
    UPDATE auth.users SET banned_until=NULL,deleted_at=NULL;
    UPDATE profiles SET account_role='agent',account_id=d.account_id WHERE user_id=d.user_id;
    IF scenario='expired' THEN UPDATE auth.sessions SET not_after=now()-interval '1 day' WHERE id=d.session_id; END IF;
    IF scenario='banned' THEN UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=d.user_id; END IF;
    IF scenario='deleted' THEN UPDATE auth.users SET deleted_at=now() WHERE id=d.user_id; END IF;
    IF scenario='viewer' THEN UPDATE profiles SET account_role='viewer' WHERE user_id=d.user_id; END IF;
    IF scenario='account' THEN UPDATE profiles SET account_id='00000000-0000-0000-0000-000000000002' WHERE user_id=d.user_id; END IF;
    UPDATE mobile_push_jobs SET state='pending',available_at=now(),lease_token=NULL,lease_until=NULL,attempts=0 WHERE device_id=d.id;
    PERFORM * FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20);
    SELECT * INTO j FROM mobile_push_jobs WHERE device_id=d.id;
    SELECT count(*) INTO prepared FROM prepare_mobile_push_job(j.id,j.lease_token);
    PERFORM test_assert(prepared=0,'current session/user/membership denied: '||scenario);
  END LOOP;
  UPDATE auth.sessions SET not_after=NULL;
  UPDATE auth.users SET banned_until=NULL,deleted_at=NULL;
  UPDATE profiles SET account_role='agent',account_id=d.account_id WHERE user_id=d.user_id;
  UPDATE mobile_push_jobs SET state='pending',available_at=now(),lease_token=NULL,lease_until=NULL,attempts=0;
END $$;

DO $$ DECLARE minute_now integer; d mobile_push_devices; j mobile_push_jobs; prepared integer; BEGIN
  minute_now:=extract(hour FROM now() AT TIME ZONE 'Asia/Qatar')::integer*60+extract(minute FROM now() AT TIME ZONE 'Asia/Qatar')::integer;
  PERFORM test_assert(set_mobile_push_preferences('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
    true,(minute_now+1439)%1440,(minute_now+2)%1440,'Asia/Qatar'),'valid quiet hours');
  PERFORM test_assert(NOT set_mobile_push_preferences('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
    true,100,200,'Mars/Unknown'),'unknown timezone denied');
  PERFORM * FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20);
  SELECT * INTO d FROM mobile_push_devices WHERE user_id='00000000-0000-0000-0000-000000000011';
  SELECT * INTO j FROM mobile_push_jobs WHERE device_id=d.id;
  SELECT count(*) INTO prepared FROM prepare_mobile_push_job(j.id,j.lease_token);
  PERFORM test_assert(prepared=0,'quiet hours defer without sending');
  PERFORM test_assert((SELECT state='pending' AND attempts=0 AND available_at>now() FROM mobile_push_jobs WHERE id=j.id),'quiet hours preserve attempt budget');
  PERFORM set_mobile_push_preferences(d.account_id,d.user_id,false,NULL,NULL,'Asia/Qatar');
  UPDATE mobile_push_jobs SET available_at=now() WHERE id=j.id;
  PERFORM * FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20);
  SELECT * INTO j FROM mobile_push_jobs WHERE id=j.id;
  SELECT count(*) INTO prepared FROM prepare_mobile_push_job(j.id,j.lease_token);
  PERFORM test_assert(prepared=0,'disabled preference prevents delivery');
  PERFORM set_mobile_push_preferences(d.account_id,d.user_id,true,NULL,NULL,'Asia/Qatar');
END $$;

UPDATE mobile_push_jobs SET state='pending',available_at=now(),lease_token=NULL,lease_until=NULL,attempts=0;
DO $$ DECLARE d mobile_push_devices; j mobile_push_jobs; old_hash text; heartbeat timestamptz; BEGIN
  PERFORM * FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20);
  SELECT * INTO d FROM mobile_push_devices WHERE user_id='00000000-0000-0000-0000-000000000011';
  SELECT * INTO j FROM mobile_push_jobs WHERE device_id=d.id;
  old_hash:=d.token_hash;
  PERFORM test_assert(NOT register_mobile_push_device(d.id,d.account_id,d.user_id,d.session_id,d.secret_hash,d.token_hash,'fake',
    d.project_id,d.app_id,'production'),'binding environment cannot be changed');
  PERFORM test_assert(register_mobile_push_device(d.id,d.account_id,d.user_id,d.session_id,d.secret_hash,repeat('b',64),'rotated-ciphertext',
    d.project_id,d.app_id,d.environment,2),'same binding rotates token');
  PERFORM test_assert(NOT register_mobile_push_device(d.id,d.account_id,d.user_id,d.session_id,d.secret_hash,old_hash,'old-ciphertext',
    d.project_id,d.app_id,d.environment,1),'stale registration cannot roll back a rotated token');
  PERFORM test_assert(finish_mobile_push_job(j.id,j.lease_token,'invalid_token',30,old_hash),'invalid old token recorded');
  PERFORM test_assert((SELECT enabled FROM mobile_push_devices WHERE id=d.id),'old failure cannot disable rotated token');
  UPDATE mobile_push_devices SET rotation_hash=repeat('f',64) WHERE id=d.id;
  SELECT last_seen_at INTO heartbeat FROM mobile_push_devices WHERE id=d.id;
  PERFORM test_assert(NOT rotate_mobile_push_device(d.id,d.secret_hash,repeat('c',64),'native-ciphertext',3,d.project_id,d.app_id,d.environment),'revocation capability cannot rotate tokens');
  PERFORM test_assert(rotate_mobile_push_device(d.id,repeat('f',64),repeat('c',64),'native-ciphertext',3,d.project_id,d.app_id,d.environment),'separate native capability rotates an existing binding');
  PERFORM test_assert((SELECT last_seen_at=heartbeat FROM mobile_push_devices WHERE id=d.id),'background rotation cannot extend foreground heartbeat');
  PERFORM test_assert(NOT rotate_mobile_push_device(d.id,repeat('f',64),repeat('b',64),'stale',2,d.project_id,d.app_id,d.environment),'background rotation is monotonic');
  PERFORM test_assert(NOT rotate_mobile_push_device(d.id,repeat('f',64),repeat('c',64),'fake',3,'other-project',d.app_id,d.environment),'rotation cannot transfer project');
  UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=d.session_id;
  PERFORM test_assert(NOT rotate_mobile_push_device(d.id,repeat('f',64),repeat('d',64),'fake',4,d.project_id,d.app_id,d.environment),'rotation cannot revive an expired session');
  UPDATE auth.sessions SET not_after=NULL WHERE id=d.session_id;
  UPDATE profiles SET account_role='viewer' WHERE user_id=d.user_id;
  PERFORM test_assert(NOT rotate_mobile_push_device(d.id,repeat('f',64),repeat('d',64),'fake',4,d.project_id,d.app_id,d.environment),'rotation rechecks current role');
  UPDATE profiles SET account_role='agent' WHERE user_id=d.user_id;
  PERFORM revoke_mobile_push_device(d.id,repeat('0',64));
  PERFORM test_assert(EXISTS(SELECT 1 FROM mobile_push_devices WHERE id=d.id),'wrong revocation secret harmless');
  PERFORM revoke_mobile_push_device(d.id,d.secret_hash);
  PERFORM test_assert(NOT EXISTS(SELECT 1 FROM mobile_push_devices WHERE id=d.id),'revocation deletes device');
  PERFORM test_assert(NOT EXISTS(SELECT 1 FROM mobile_push_jobs WHERE device_id=d.id),'revocation cascades jobs');
END $$;
UPDATE mobile_push_jobs SET state='pending',lease_until=NULL,attempts=5;
SELECT * FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',20);
SELECT test_assert((SELECT bool_and(state='dead') FROM mobile_push_jobs),'bounded attempts');
DELETE FROM auth.sessions;
SELECT test_assert((SELECT count(*)=0 FROM mobile_push_devices),'session removal cascades credentials');
SELECT test_assert((SELECT count(*)=0 FROM mobile_push_jobs),'session removal cascades queued jobs');
SELECT test_assert(NOT has_table_privilege('authenticated','mobile_push_devices','SELECT'),'tokens have no client table grant');
SELECT test_assert(NOT has_function_privilege('anon','revoke_mobile_push_device(uuid,text)','EXECUTE'),'no direct anonymous RPC capability');
SELECT test_assert(NOT has_function_privilege('authenticated','register_mobile_push_device(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,text)','EXECUTE'),'no direct client registration RPC');
SELECT 'PASS isolated mobile push SQL: scopes, roles/session, durable source dedup, leases, assignment recheck, quiet hours/preferences, rotation-safe invalidation, revoke and grants.';
