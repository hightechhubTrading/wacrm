import { createClient } from '@supabase/supabase-js';
import { nativePersistence, sessionStorage } from './session-storage';
export const backendUrl = import.meta.env.VITE_SUPABASE_URL as string;
// Reads plus user authentication only. No database mutation/RPC transport.
export async function readOnlyFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const allowedAuth = ['/auth/v1/token', '/auth/v1/logout', '/auth/v1/user'];
  if (
    url.origin !== new URL(backendUrl).origin ||
    !(
      request.method === 'GET' ||
      (request.method === 'POST' && allowedAuth.includes(url.pathname))
    )
  ) {
    throw new Error('This app supports read-only access.');
  }
  return fetch(request, { signal: AbortSignal.timeout(20000) });
}
export const db = createClient(
  backendUrl,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: nativePersistence,
      storageKey: 'hth-mobile-session',
      ...(nativePersistence ? { storage: sessionStorage } : {}),
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { fetch: readOnlyFetch },
  }
);
