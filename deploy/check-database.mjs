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
  for (const [table, columns, migration] of [
    [
      'ai_products',
      'superseded_by,parent_id,kind,status,aliases,specifications,limitations,source_url,source_notes',
      '078',
    ],
    [
      'ai_knowledge_documents',
      'document_type,guide_sections,collection_only,status,topic,product_id,source_url,source_notes',
      '079',
    ],
    ['conversations', 'ai_handoff_reason', '077'],
    [
      'ai_catalog_questions',
      'id,product_id,question,answer,evidence,confirmed_by,confirmed_on,status',
      '078',
    ],
    ['ai_product_search_chunks', 'id,product_id,content,embedding', '078'],
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
        `Database preflight failed for ${table}. Apply migration ${migration} before deploying this revision.`
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
