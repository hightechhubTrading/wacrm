import { pathToFileURL } from 'node:url';

/** Fail a deployment candidate before promotion when its database is too old.
 * Column probes read zero rows. The RPC probe has no conversation and no user
 * identity; the authenticated-only function must reject it without any writes.
 */
export async function checkDeploymentDatabase({
  url,
  serviceRoleKey,
  fetchImpl = fetch,
}) {
  if (!url || !serviceRoleKey)
    throw new Error(
      'Database preflight requires server Supabase configuration.'
    );
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  for (const [table, columns] of [
    [
      'ai_products',
      'parent_id,kind,status,aliases,specifications,limitations,source_url,source_notes',
    ],
    [
      'ai_knowledge_documents',
      'status,topic,product_id,source_url,source_notes',
    ],
    ['conversations', 'ai_handoff_reason'],
  ]) {
    const endpoint = new URL(`/rest/v1/${table}`, url);
    endpoint.searchParams.set('select', columns);
    endpoint.searchParams.set('limit', '0');
    const response = await fetchImpl(endpoint, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Database preflight failed for ${table}. Apply migration 077 before deploying this revision.`
      );
  }
  const response = await fetchImpl(
    new URL('/rest/v1/rpc/record_conversation_conversion', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_conversation_id: null,
        p_stage: 'qualified',
        p_value: null,
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const result = await response.json().catch(() => null);
  if (!response.ok && result?.code === '42501') return;
  throw new Error(
    'Database preflight failed for conversion authorization. Apply migration 076 and verify its RPC permissions before deploying this revision.'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkDeploymentDatabase({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
    .then(() => console.log('Database deployment preflight passed.'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
