/** Optional server diagnostics. Never include query strings, bodies or identities. */
export async function measureServerOperation<T>(
  operation: string,
  run: () => Promise<T>
): Promise<T> {
  if (process.env.PERFORMANCE_LOGS !== '1') return run();
  const started = performance.now();
  try {
    return await run();
  } finally {
    console.info(
      JSON.stringify({
        event: 'crm-performance',
        operation,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      })
    );
  }
}

/** Supabase auth/database requests can otherwise disappear inside API latency. */
export const performanceFetch: typeof fetch = async (input, init) => {
  if (process.env.PERFORMANCE_LOGS !== '1') return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  const path = url.pathname;
  const rest = path.match(/^\/rest\/v1\/(rpc\/)?([a-zA-Z0-9_]+)$/);
  const operation = rest
    ? `supabase.${rest[1] ? 'rpc' : 'table'}.${rest[2]}`
    : path === '/auth/v1/user'
      ? 'supabase.auth.user'
      : 'supabase.request';
  return measureServerOperation(operation, () => fetch(input, init));
};
