import { createClient as createUserClient } from '@supabase/supabase-js';
import { createClient as createCookieClient } from './server';

/** Human bearer sessions use the public key and user RLS, never service-role credentials. */
export async function createRequestClient(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return createCookieClient();
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization))
    throw new Error('Invalid authorization');
  return createUserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authorization } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
