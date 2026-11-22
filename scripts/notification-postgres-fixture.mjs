/** Disposable Postgres database, unique roles and separate connections for lock tests. */
import { execFileSync, spawn } from 'node:child_process';
function session(transport, database, roles) {
  const child = spawn(transport.program, transport.args(database), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '',
    pending,
    sequence = 0;
  child.stdout.setEncoding('utf8');
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    stderr += text;
  });
  child.stdout.on('data', (text) => {
    stdout += text;
    const marker = pending?.marker;
    if (!marker) return;
    const index = stdout.indexOf(marker + ' '),
      end = stdout.indexOf('\n', index);
    if (index < 0 || end < 0) return;
    const line = stdout.slice(index, end).trim().split(' '),
      output = stdout.slice(0, index).trim();
    stdout = stdout.slice(end + 1);
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    if (line[1] === 'true')
      request.reject(new Error(`Fixture SQL failed (${line[2]}): ${output}`));
    else request.resolve(output);
  });
  child.on('exit', () => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Fixture SQL connection closed: ' + stderr));
      pending = null;
    }
  });
  const exec = (sql) =>
    new Promise((resolve, reject) => {
      if (pending)
        return reject(
          new Error('Use sequential SQL on each fixture connection')
        );
      const marker = `__SQL_END_${++sequence}__`;
      pending = {
        marker,
        resolve,
        reject,
        timer: setTimeout(() => {
          child.kill();
          reject(new Error('Fixture SQL timed out'));
        }, 30000),
      };
      for (const [role, value] of Object.entries(roles))
        sql = sql.replaceAll(new RegExp(`\\b${role}\\b`, 'g'), value);
      const strict =
        /\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|SCHEMA|ROLE|TRIGGER|POLICY|INDEX)/i.test(
          sql
        );
      child.stdin.write(
        (strict ? '\\set ON_ERROR_STOP on\n' : '') +
          sql.trimEnd() +
          (sql.trimEnd().endsWith(';') ? '' : ';') +
          (strict ? '\n\\set ON_ERROR_STOP off' : '') +
          '\n\\echo ' +
          marker +
          ' :ERROR :SQLSTATE\n'
      );
    });
  return {
    exec,
    query: async (sql) => ({
      rows: JSON.parse(
        await exec(
          `SELECT coalesce(json_agg(row_to_json(t)),'[]'::json) FROM (${sql.replace(/;\s*$/, '')})t;`
        )
      ),
    }),
    close: async () => {
      if (child.exitCode !== null) return;
      child.stdin.end();
      await new Promise((resolve) => child.once('close', resolve));
    },
  };
}
export async function createNotificationPostgresFixture() {
  const key = process.env.NOTIFICATION_SQL_SSH_KEY,
    target = process.env.NOTIFICATION_SQL_SSH_TARGET,
    container = process.env.NOTIFICATION_SQL_CONTAINER;
  if (!container && (!key || !target))
    throw new Error(
      'Disposable Postgres container or fixture SSH configuration required'
    );
  const name = `wacrm_notification_fixture_${Date.now()}`,
    roles = {
      anon: `${name}_anon`,
      authenticated: `${name}_auth`,
      service_role: `${name}_service`,
    };
  const transport = container
    ? {
        program: 'docker',
        args: (db) => [
          'exec',
          '-i',
          container,
          'psql',
          '-U',
          'postgres',
          '-d',
          db,
          '--no-psqlrc',
          '-qAt',
        ],
      }
    : {
        program: 'ssh',
        args: (db) => [
          '-i',
          key,
          '-o',
          'IdentitiesOnly=yes',
          '-o',
          'StrictHostKeyChecking=yes',
          '-o',
          'ConnectTimeout=10',
          target,
          `docker exec -i hth_postgres sh -c 'exec psql -U "$POSTGRES_USER" -d ${db} --no-psqlrc -qAt'`,
        ],
      };
  const admin = (sql) =>
    execFileSync(transport.program, transport.args('postgres'), {
      input: '\\set ON_ERROR_STOP on\n' + sql,
      encoding: 'utf8',
      timeout: 30000,
    });
  admin(
    `CREATE DATABASE ${name};` +
      Object.entries(roles)
        .map(
          ([role, value]) =>
            `CREATE ROLE ${value} NOLOGIN ${role === 'service_role' ? 'BYPASSRLS' : ''};`
        )
        .join('')
  );
  const main = session(transport, name, roles);
  return {
    ...main,
    fork: () => session(transport, name, roles),
    close: async () => {
      await main.close();
      admin(
        `DROP DATABASE ${name} WITH(FORCE);` +
          Object.values(roles)
            .map((role) => `DROP ROLE ${role};`)
            .join('')
      );
      console.log('Removed disposable PostgreSQL database and roles.');
    },
  };
}
