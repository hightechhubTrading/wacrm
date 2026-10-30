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
      'id,product_id,question,answer,evidence,confirmed_by,confirmed_on,status,gap_key',
      '081',
    ],
    ['ai_product_search_chunks', 'id,product_id,content,embedding', '078'],
    ['ai_configs', 'company_facts,behavior_v2_enabled', '080'],
    [
      'ai_media_actions',
      'id,status,provider_message_id,failure_code,file_snapshot_id',
      '081',
    ],
    ['ai_reply_events', 'details', '080'],
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
  if (response.ok || result?.code !== '42501')
    throw new Error(
      'Database preflight failed for conversion authorization. Apply migration 076 and verify its RPC permissions before deploying this revision.'
    );
  // This read-only query uses a null account and cannot expose customer rows.
  const today = await fetchImpl(
    new URL('/rest/v1/rpc/sales_today_replies', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_account: null }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const preview = await today.json().catch(() => null);
  if (
    !today.ok ||
    preview?.count !== 0 ||
    !Array.isArray(preview?.items) ||
    preview.items.length !== 0
  )
    throw new Error(
      'Database preflight failed for Sales Today. Apply migration 082 before deploying this revision.'
    );
  await checkPerformanceDatabase({ url, headers, fetchImpl });
  const ledgerUrl = new URL('/rest/v1/outbound_send_operations', url);
  ledgerUrl.searchParams.set(
    'select',
    'id,account_id,user_id,conversation_id,request_hash,state,message_id,whatsapp_message_id,error_code,created_at,updated_at'
  );
  ledgerUrl.searchParams.set('limit', '0');
  const ledger = await fetchImpl(ledgerUrl, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!ledger.ok)
    throw new Error(
      'Database preflight failed for send recovery. Apply migration 087 before deploying this revision.'
    );
  for (const [name, parameters, valid] of [
    [
      'search_inbox_messages',
      { p_account: null, p_query: 'preflight' },
      (value) =>
        Array.isArray(value?.items) &&
        value.items.length === 0 &&
        value.total === 0 &&
        value.nextCursor === null,
    ],
    [
      'inbox_message_context',
      { p_account: null, p_conversation: null, p_message: null },
      (value) =>
        value?.found === false &&
        Array.isArray(value.messages) &&
        value.messages.length === 0,
    ],
  ]) {
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !valid(result))
      throw new Error(
        `Database preflight failed for ${name}. Apply migration 088 before deploying this revision.`
      );
  }
  const activityUrl = new URL('/rest/v1/conversation_activity', url);
  activityUrl.searchParams.set(
    'select',
    'conversation_id,account_id,user_id,tab_id,sequence,active,last_seen_at,composing_until'
  );
  activityUrl.searchParams.set('limit', '0');
  const activity = await fetchImpl(activityUrl, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!activity.ok)
    throw new Error(
      'Database preflight failed for conversation activity. Apply migration 089 before deploying this revision.'
    );
  const snapshot = await fetchImpl(
    new URL('/rest/v1/rpc/conversation_activity_snapshot', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_conversation: null, p_tab: null }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const peers = await snapshot.json().catch(() => null);
  if (
    !snapshot.ok ||
    !Array.isArray(peers?.peers) ||
    peers.peers.length !== 0 ||
    !Number.isFinite(Date.parse(peers.serverNow))
  )
    throw new Error(
      'Database preflight failed for activity snapshot. Apply migration 089 before deploying this revision.'
    );
  // Deliberately identity-free: this must be denied before any activity write.
  const denied = await fetchImpl(
    new URL('/rest/v1/rpc/record_conversation_activity', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_conversation: null,
        p_tab: null,
        p_sequence: 1,
        p_composing: false,
        p_leave: false,
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const denial = await denied.json().catch(() => null);
  if (denied.ok || denial?.code !== '42501')
    throw new Error(
      'Database preflight failed for activity write authorization. Apply migration 089 before deploying this revision.'
    );
}

/** Signature/cache checks without a customer/account/user identity. Service-role
 * EXECUTE may deliberately be denied; 42501 still proves the endpoint resolved.
 * These SQL functions are read-only and null-scoped probes return no customer data.
 */
async function checkPerformanceDatabase({ url, headers, fetchImpl }) {
  const emptyItems = (result) =>
    Array.isArray(result?.items) &&
    result.items.length === 0 &&
    result.total === 0;
  const probes = [
    [
      'dashboard_metrics',
      '083',
      { p_today: null, p_yesterday: null },
      (result) => result === null,
    ],
    [
      'dashboard_message_series',
      '083',
      { p_start: null, p_days: 1, p_timezone: 'UTC' },
      (result) => Array.isArray(result) && result.length === 0,
    ],
    [
      'dashboard_pipeline_summary',
      '083',
      {},
      (result) =>
        Array.isArray(result?.stages) &&
        result.stages.length === 0 &&
        result.totalValue === 0,
    ],
    [
      'dashboard_response_time',
      '083',
      {
        p_start: null,
        p_this_week: null,
        p_last_week: null,
        p_timezone: 'UTC',
      },
      (result) => result === null,
    ],
    [
      'inbox_list',
      '084',
      {
        p_account: null,
        p_search: '',
        p_view: 'all',
        p_sort: 'priority',
        p_tags: [],
        p_company: null,
        p_agent: null,
        p_day_end: null,
        p_cursor: null,
        p_limit: 1,
        p_sales: false,
        p_metadata_only: true,
      },
      emptyItems,
    ],
    [
      'pipeline_list',
      '085',
      {
        p_pipeline: null,
        p_filters: {},
        p_view: 'list',
        p_page: 0,
        p_stage_pages: {},
        p_today: null,
        p_week_end: null,
        p_fallback_currency: 'USD',
      },
      emptyItems,
    ],
    ['account_profile', '086', {}, (result) => result === null],
  ];
  for (const [name, migration, body, valid] of probes) {
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    // Undefined sentinel distinguishes invalid JSON from a valid JSON null.
    const result = await response.json().catch(() => undefined);
    const denied = response.status === 403 && result?.code === '42501';
    if (!denied && (!response.ok || !valid(result)))
      throw new Error(
        `Database preflight failed for ${name}. Apply migration ${migration} and refresh the schema cache before deploying this revision.`
      );
  }
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
