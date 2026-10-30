/** Disposable account snapshot/RLS checks. No production connection. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const user = '10000000-0000-0000-0000-000000000001',
  other = '10000000-0000-0000-0000-000000000002',
  account = '20000000-0000-0000-0000-000000000001';
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE accounts(id uuid,name text,default_currency text);
 CREATE TABLE profiles(id uuid,user_id uuid,account_id uuid,account_role text,full_name text,email text,avatar_url text,role text,beta_features text[],theme text,mode text,locale text,phone text);
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;GRANT SELECT ON profiles,accounts TO authenticated;
 ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;CREATE POLICY p ON profiles TO authenticated USING(account_id::text=current_setting('app.account') OR user_id=auth.uid());
 ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;CREATE POLICY a ON accounts TO authenticated USING(id::text=current_setting('app.account'));
 INSERT INTO accounts VALUES('${account}','Fixture account','QAR');
 INSERT INTO profiles VALUES('${user}','${user}','${account}','owner','Own profile','own@example.test',NULL,'admin','{}','violet','light','ar',NULL),
 ('${other}','${other}','${account}','agent','Other profile','other@example.test',NULL,'agent','{}',NULL,NULL,NULL,NULL);
 `);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/086_account_profile.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(
    `SET ROLE authenticated;SET app.account='${account}';SET request.jwt.claim.sub='${user}';`
  );
  const read = async () =>
    (await db.query('SELECT account_profile() AS data')).rows[0].data;
  const result = await read();
  assert.equal(result.profile.user_id, user);
  assert.equal(result.profile.account_role, 'owner');
  assert.equal(result.account.default_currency, 'QAR');
  assert.ok(!JSON.stringify(result).includes('other@example.test'));
  await db.exec(`SET request.jwt.claim.sub='${other}'`);
  assert.equal((await read()).profile.user_id, other);
  await db.exec(`SET app.account='hidden';SET request.jwt.claim.sub='${user}'`);
  const hidden = await read();
  assert.equal(hidden.profile.user_id, user);
  assert.equal(hidden.account, null);
  await db.exec(
    `SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000003'`
  );
  assert.equal(await read(), null);
  await db.exec(`SET request.jwt.claim.sub=''`);
  assert.equal(await read(), null);
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(read(), /permission denied/);
  console.log(
    'Account SQL checks passed: own-profile binding, colleague isolation, account role/currency, hidden account metadata, missing session/profile and anonymous denial.'
  );
} finally {
  await db.close();
}
