/** Isolated PostgreSQL contract check. Never points psql at the live CRM DB. */
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
const key = process.env.MOBILE_SQL_SSH_KEY;
const target = process.env.MOBILE_SQL_SSH_TARGET;
const container = process.env.MOBILE_SQL_CONTAINER;
if (!container && (!key || !target))
  throw new Error(
    'Set MOBILE_SQL_CONTAINER or MOBILE_SQL_SSH_KEY/MOBILE_SQL_SSH_TARGET'
  );
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const database = `wacrm_push_fixture_${Date.now()}`;
const roles = {
  anon: `${database}_anon`,
  authenticated: `${database}_auth`,
  service_role: `${database}_service`,
};
function command(db) {
  if (db !== 'postgres' && db !== database)
    throw new Error('Refused non-fixture database');
  return container
    ? [
        'docker',
        [
          'exec',
          '-i',
          container,
          'psql',
          '-U',
          'postgres',
          '-d',
          db,
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
        ],
      ]
    : [
        'ssh',
        [
          '-i',
          key,
          '-o',
          'BatchMode=yes',
          '-o',
          'IdentitiesOnly=yes',
          '-o',
          'StrictHostKeyChecking=yes',
          '-o',
          'ConnectTimeout=10',
          target,
          'docker exec -i hth_postgres sh -c ' +
            quote(
              `exec psql -U "$POSTGRES_USER" -d ${db} -v ON_ERROR_STOP=1 -At`
            ),
        ],
      ];
}
function sql(db, input) {
  const [program, args] = command(db);
  return execFileSync(program, args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
    timeout: 120000,
  });
}
function sqlAsync(db, input) {
  const [program, args] = command(db);
  return new Promise((resolve, reject) => {
    const child = execFile(
      program,
      args,
      { encoding: 'utf8', timeout: 30000 },
      (error, output) => (error ? reject(error) : resolve(output))
    );
    child.stdin.end(input);
  });
}
try {
  sql(
    'postgres',
    `CREATE DATABASE ${database};` +
      Object.entries(roles)
        .map(
          ([role, name]) =>
            `CREATE ROLE ${name} NOLOGIN ${role === 'service_role' ? 'BYPASSRLS' : ''};`
        )
        .join('')
  );
  let fixture = readFileSync('scripts/test-mobile-push.sql', 'utf8').replace(
    '-- MIGRATION',
    () => readFileSync('supabase/migrations/100_mobile_push.sql', 'utf8')
  );
  for (const [role, name] of Object.entries(roles))
    fixture = fixture.replaceAll(new RegExp(`\\b${role}\\b`, 'g'), name);
  const output = sql(database, fixture);
  if (!output.includes('PASS isolated mobile push SQL'))
    throw new Error('Missing SQL assertions');
  console.log(
    output.split('\n').find((line) => line.startsWith('PASS isolated'))
  );
  sql(
    database,
    `DO $$ DECLARE sid uuid:=gen_random_uuid(); BEGIN
    INSERT INTO auth.sessions VALUES(sid,'00000000-0000-0000-0000-000000000012');
    PERFORM register_mobile_push_device(gen_random_uuid(),'00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000012',sid,repeat('c',64),repeat('d',64),'fake','test-project','com.hightechhub.crm.demo','development');
    INSERT INTO messages SELECT gen_random_uuid(),'00000000-0000-0000-0000-000000000021','customer' FROM generate_series(1,5);
  END $$;`
  );
  const overlapping = await Promise.all(
    [1, 2].map(() =>
      sqlAsync(
        database,
        "BEGIN; SELECT id FROM claim_mobile_push_jobs('test-project','development','com.hightechhub.crm.demo',3); SELECT pg_sleep(1); COMMIT;"
      )
    )
  );
  const ids = overlapping.flatMap((output) =>
    output.split('\n').filter((line) => /^[a-f0-9-]{36}$/.test(line))
  );
  if (ids.length !== 5 || new Set(ids).size !== 5)
    throw new Error('Overlapping workers claimed duplicate/missing jobs');
  console.log(
    'PASS overlapping PostgreSQL transactions: five jobs, five unique claims.'
  );
  // Exercise real permission denial, not just introspection of the ACL.
  for (const query of [
    `SET ROLE ${roles.authenticated}; SELECT * FROM mobile_push_devices;`,
    `SET ROLE ${roles.anon}; SELECT revoke_mobile_push_device(NULL,NULL);`,
  ]) {
    let denied = false;
    try {
      sql(database, query);
    } catch (e) {
      denied = String(e.stderr).includes('permission denied');
    }
    if (!denied) throw new Error('Client permission denial not proved');
  }
  console.log('PASS actual client table/RPC denial. No provider requests.');
} catch (e) {
  console.error(e.stderr?.toString() || e.message);
  process.exitCode = 1;
} finally {
  sql(
    'postgres',
    `DROP DATABASE IF EXISTS ${database} WITH (FORCE);` +
      Object.values(roles)
        .map((name) => `DROP ROLE IF EXISTS ${name};`)
        .join('')
  );
  console.log('Temporary database and fixture roles removed.');
}
