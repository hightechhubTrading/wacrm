/** Disposable PostgreSQL-compatible checks. No production connection or credentials. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const account = '10000000-0000-0000-0000-000000000001';
const otherAccount = '10000000-0000-0000-0000-000000000002';
const owner = '20000000-0000-0000-0000-000000000001';
const agent = '20000000-0000-0000-0000-000000000002';
const colleague = '20000000-0000-0000-0000-000000000003';
const outsider = '20000000-0000-0000-0000-000000000004';
const viewer = '20000000-0000-0000-0000-000000000005';
const contact = '30000000-0000-0000-0000-000000000001';
let sequence = 0;
const uuid = () =>
  `40000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`;
try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE profiles(user_id uuid,account_id uuid,account_role text);
    CREATE FUNCTION public.is_account_member(a uuid,r text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=a AND
        CASE account_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END >=
        CASE r WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END)
    $$;
    CREATE TABLE contacts(id uuid PRIMARY KEY,account_id uuid,name text,phone text);
    CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,contact_id uuid,status text,assigned_agent_id uuid,unread_count integer DEFAULT 0);
    CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,sender_type text,content_text text,created_at timestamptz,status text);
    ALTER TABLE conversations ENABLE ROW LEVEL SECURITY; ALTER TABLE messages ENABLE ROW LEVEL SECURITY; ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY c_read ON conversations FOR SELECT TO authenticated USING(is_account_member(account_id,'admin') OR (is_account_member(account_id,'agent') AND assigned_agent_id=auth.uid()));
    CREATE POLICY m_read ON messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM conversations WHERE id=conversation_id));
    CREATE POLICY ct_read ON contacts FOR SELECT TO authenticated USING(is_account_member(account_id));
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    GRANT SELECT ON conversations,messages,contacts TO authenticated;
  `);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/082_sales_today_replies.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  for (const [id, a, role] of [
    [owner, account, 'owner'],
    [agent, account, 'agent'],
    [colleague, account, 'agent'],
    [outsider, otherAccount, 'owner'],
    [viewer, account, 'viewer'],
  ]) {
    await db.query('INSERT INTO profiles VALUES($1,$2,$3)', [id, a, role]);
  }
  await db.query('INSERT INTO contacts VALUES($1,$2,$3,$4)', [
    contact,
    account,
    'Synthetic customer',
    '+15550000000',
  ]);
  const conversation = async (
    status = 'open',
    assigned = agent,
    a = account
  ) => {
    const id = uuid();
    await db.query('INSERT INTO conversations VALUES($1,$2,$3,$4,$5,0)', [
      id,
      a,
      contact,
      status,
      assigned,
    ]);
    return id;
  };
  const message = async (c, sender, time, status = 'delivered') => {
    const id = uuid();
    await db.query('INSERT INTO messages VALUES($1,$2,$3,$4,$5,$6)', [
      id,
      c,
      sender,
      `Synthetic ${sender}`,
      time,
      status,
    ]);
    return id;
  };
  const unanswered = await conversation();
  await message(unanswered, 'customer', '2026-10-28T08:00:00Z');
  await message(unanswered, 'agent', '2026-10-28T09:00:00Z', 'failed');
  await message(unanswered, 'system', '2026-10-28T10:00:00Z');
  const answered = await conversation();
  await message(answered, 'customer', '2026-10-28T08:00:00Z');
  await message(answered, 'agent', '2026-10-28T09:00:00Z');
  const botAnswered = await conversation();
  await message(botAnswered, 'customer', '2026-10-28T08:00:00Z');
  await message(botAnswered, 'bot', '2026-10-28T09:00:00Z');
  const closed = await conversation('closed');
  await message(closed, 'customer', '2026-10-28T08:00:00Z');
  const foreign = await conversation('open', outsider, otherAccount);
  await message(foreign, 'customer', '2026-10-28T08:00:00Z');
  const hidden = await conversation('open', colleague);
  await message(hidden, 'customer', '2026-10-28T08:00:00Z');
  const empty = await conversation();
  const tied = await conversation();
  await message(tied, 'customer', '2026-10-28T08:00:00Z');
  await message(tied, 'agent', '2026-10-28T08:00:00Z');
  async function load(user, a = account) {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec('SET ROLE authenticated');
    try {
      return (await db.query('SELECT sales_today_replies($1) AS result', [a]))
        .rows[0].result;
    } finally {
      await db.exec('RESET ROLE');
    }
  }
  const first = await load(agent);
  assert.equal(first.count, 1);
  assert.deepEqual(
    first.items.map((x) => x.id),
    [unanswered]
  );
  assert.equal(first.items[0].contact.name, 'Synthetic customer');
  assert.ok(
    !first.items.some((x) =>
      [answered, botAnswered, closed, foreign, hidden, empty, tied].includes(
        x.id
      )
    )
  );
  assert.equal(
    (await load(agent, otherAccount)).count,
    0,
    'Foreign account must be empty'
  );
  assert.equal(
    (await load(outsider)).count,
    0,
    'Another tenant cannot query this account'
  );
  assert.equal(
    (await load(viewer)).count,
    0,
    'Viewer must not get operational data'
  );
  assert.equal(
    (await load(owner)).count,
    2,
    'Owner sees other assigned visible chats'
  );
  for (let i = 0; i < 8; i++) {
    const c = await conversation('pending');
    await message(
      c,
      'customer',
      `2026-10-29T${String(i).padStart(2, '0')}:00:00Z`
    );
  }
  const more = await load(agent);
  assert.equal(more.count, 9);
  assert.equal(more.items.length, 6);
  assert.equal(
    more.items[0].id,
    unanswered,
    'Oldest unanswered customer first'
  );
  const settings = (
    await db.query(
      "SELECT prosecdef FROM pg_proc WHERE oid='sales_today_replies(uuid)'::regprocedure"
    )
  ).rows[0];
  assert.equal(settings.prosecdef, false, 'RLS must use caller privileges');
  const anonymous = (
    await db.query(
      "SELECT has_function_privilege('anon','sales_today_replies(uuid)','EXECUTE') AS allowed"
    )
  ).rows[0];
  assert.equal(anonymous.allowed, false);
  console.log(
    'Sales Today SQL checks passed: latest sender, read-but-unanswered, failed/internal messages, ties, closed chats, tenant/role/assignment isolation, exact count/preview and oldest-first order.'
  );
} finally {
  await db.close();
}
