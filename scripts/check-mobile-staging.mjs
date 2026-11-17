/** Read-only user-session probe. Never loads the CRM's production env files. */
import { createClient } from '@supabase/supabase-js';

const required = [
  'MOBILE_PROBE_TARGET',
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_PUBLISHABLE_KEY',
  'STAGING_USER_EMAIL',
  'STAGING_USER_PASSWORD',
  'STAGING_ACCOUNT_ID',
  'STAGING_CONVERSATION_ID',
  'STAGING_FORBIDDEN_CONVERSATION_ID',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.MOBILE_PROBE_TARGET !== 'staging') {
  console.error(
    'MOBILE_PROBE_TARGET must be staging. See docs/capacitor-phase-1.md.'
  );
  process.exit(1);
}
const url = new URL(process.env.STAGING_SUPABASE_URL);
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(url.hostname)
) {
  console.error('Use HTTPS for hosted staging.');
  process.exit(1);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const key of [
  'STAGING_ACCOUNT_ID',
  'STAGING_CONVERSATION_ID',
  'STAGING_FORBIDDEN_CONVERSATION_ID',
]) {
  if (!uuid.test(process.env[key])) {
    console.error(`${key} must be a UUID.`);
    process.exit(1);
  }
}
if (
  process.env.STAGING_CONVERSATION_ID ===
  process.env.STAGING_FORBIDDEN_CONVERSATION_ID
) {
  console.error('Allowed and forbidden fixture conversations must differ.');
  process.exit(1);
}

// No persisted session, service-role client, customer content or token logging.
const db = createClient(
  url.href,
  process.env.STAGING_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  }
);
let stage = 'password login';
function check(ok) {
  if (!ok) throw new Error('probe_failed');
  console.log(`PASS ${stage}`);
}
try {
  const login = await db.auth.signInWithPassword({
    email: process.env.STAGING_USER_EMAIL,
    password: process.env.STAGING_USER_PASSWORD,
  });
  check(!login.error && !!login.data.user);
  stage = 'expected account membership';
  const profile = await db
    .from('profiles')
    .select('account_id,account_role')
    .eq('user_id', login.data.user.id)
    .single();
  check(
    !profile.error &&
      profile.data?.account_id === process.env.STAGING_ACCOUNT_ID &&
      ['owner', 'admin', 'agent', 'viewer'].includes(profile.data?.account_role)
  );
  stage = 'bounded conversation list';
  const list = await db
    .from('conversations')
    .select('id,account_id')
    .eq('account_id', process.env.STAGING_ACCOUNT_ID)
    .order('id')
    .limit(20);
  check(
    !list.error &&
      list.data?.length > 0 &&
      list.data.every(
        (row) => row.account_id === process.env.STAGING_ACCOUNT_ID
      )
  );
  stage = 'open seeded conversation';
  const conversation = await db
    .from('conversations')
    .select('id,account_id')
    .eq('id', process.env.STAGING_CONVERSATION_ID)
    .single();
  check(
    !conversation.error &&
      conversation.data?.account_id === process.env.STAGING_ACCOUNT_ID
  );
  stage = 'read seeded message history';
  const messages = await db
    .from('messages')
    .select('id,conversation_id')
    .eq('conversation_id', process.env.STAGING_CONVERSATION_ID)
    .order('created_at', { ascending: false })
    .limit(50);
  check(!messages.error && messages.data?.length > 0);
  // Deliberately omit account filters here: a client filter cannot prove RLS.
  stage = 'known forbidden conversation hidden by RLS';
  const forbidden = await db
    .from('conversations')
    .select('id')
    .eq('id', process.env.STAGING_FORBIDDEN_CONVERSATION_ID);
  check(!forbidden.error && forbidden.data?.length === 0);
  stage = 'known forbidden message history hidden by RLS';
  const hiddenMessages = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', process.env.STAGING_FORBIDDEN_CONVERSATION_ID)
    .limit(1);
  check(!hiddenMessages.error && hiddenMessages.data?.length === 0);
  stage = 'refresh user session';
  const refresh = await db.auth.refreshSession();
  check(!refresh.error && refresh.data.user?.id === login.data.user.id);
  stage = 'access after session refresh';
  const afterRefresh = await db
    .from('conversations')
    .select('id')
    .eq('id', process.env.STAGING_CONVERSATION_ID)
    .single();
  check(!afterRefresh.error && !!afterRefresh.data);
  console.log(
    'Hosted user-session probe passed. Native WebView/CORS/device proof remains separate.'
  );
} catch {
  // Intentionally suppress raw provider errors; they can contain request details.
  console.error(
    `FAIL ${stage}. Inspect staging configuration and permissions; no sensitive response was logged.`
  );
  process.exitCode = 1;
} finally {
  // Local scope avoids revoking this user's sessions on other devices.
  await db.auth.signOut({ scope: 'local' }).catch(() => {});
}
