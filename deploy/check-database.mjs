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
  for (const [table, columns] of [
    ['quotation_knowledge_batches', 'id,account_id,source_version,sources'],
    [
      'quotation_knowledge_records',
      'id,account_id,batch_id,review_status,review_version,configuration',
    ],
    ['quotation_knowledge_reviews', 'record_id,version,status,configuration'],
    [
      'quotation_sales_notes',
      'quotation_id,account_id,reason,follow_up_date,version',
    ],
  ]) {
    const endpoint = new URL('/rest/v1/' + table, url);
    endpoint.searchParams.set('select', columns);
    endpoint.searchParams.set('limit', '0');
    const response = await fetchImpl(endpoint, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        'Database preflight failed for quotation knowledge. Apply migration 090 before deploying this revision.'
      );
  }
  for (const [table, columns] of [
    [
      'ai_products',
      'id,inventory_type,sku,name_ar,unit_of_measure,customer_visible',
    ],
    [
      'catalog_items',
      'id,price_min,price_max,price_unit,review_status,customer_visible',
    ],
    ['product_source_links', 'product_id,source_record_id,relationship'],
    [
      'catalog_question_findings',
      'question_id,coverage,finding,remaining_question',
    ],
  ]) {
    const endpoint = new URL('/rest/v1/' + table, url);
    endpoint.searchParams.set('select', columns);
    endpoint.searchParams.set('limit', '0');
    const response = await fetchImpl(endpoint, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        'Database preflight failed for shared inventory. Apply migration 091 before deploying this revision.'
      );
  }
  const details = await fetchImpl(
    new URL('/rest/v1/rpc/quotation_document_details_valid', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p: {
          knowledge: { prices: {}, references: [] },
          formatVersion: 2,
          paymentPlan: { stages: [{ percent: 100, event: 'acceptance' }] },
          itemOptions: {
            '10000000-0000-4000-8000-000000000001': {
              drawingReference: 'Synthetic W-01',
              selections: { finish: 'White' },
            },
          },
          catalogueSeed: {
            item: {
              id: '10000000-0000-4000-8000-000000000001',
              productId: '20000000-0000-4000-8000-000000000001',
              itemType: 'line',
              description: 'Synthetic schema probe',
              qty: 1,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!details.ok || (await details.json().catch(() => false)) !== true)
    throw new Error(
      'Database preflight failed for quotation creation. Apply migration 093 before deploying this revision.'
    );
  const workflow = await fetchImpl(
    new URL('/rest/v1/conversations?select=work_status&limit=0', url),
    { headers, signal: AbortSignal.timeout(15000) }
  );
  if (!workflow.ok)
    throw new Error(
      'Database preflight failed for conversation workflow. Apply migration 095 before deploying this revision.'
    );
  const receipt = await fetchImpl(
    new URL('/rest/v1/rpc/claim_ai_review_receipt', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_account_id: null,
        p_conversation_id: null,
        p_trigger_message_id: null,
        p_expected_assignee: null,
        p_max_replies: 0,
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!receipt.ok || (await receipt.json().catch(() => null)) !== false)
    throw new Error(
      'Database preflight failed for AI review receipts. Apply migration 096 before deploying this revision.'
    );
  for (const path of [
    '/rest/v1/group_handoffs?select=responsible_profile_id,appointment:job_appointments(id)&limit=0',
    '/rest/v1/job_appointments?select=id,handoff_id,deal_id,kind,starts_at,ends_at,status,responsible_profile_id,responsible_name,revision&limit=0',
  ]) {
    const response = await fetchImpl(new URL(path, url), {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        'Database preflight failed for the company calendar. Apply migration 097 before deploying this revision.'
      );
  }
  const ready = await fetchImpl(
    new URL('/rest/v1/rpc/job_calendar_ready', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!ready.ok || (await ready.json().catch(() => false)) !== true)
    throw new Error(
      'Database preflight failed for calendar capacity/permissions. Apply migration 097 before deploying this revision.'
    );
  for (const [name, body] of [
    [
      'create_scheduled_group_handoff',
      {
        p_account: null,
        p_deal: null,
        p_actor: null,
        p_kind: null,
        p_location: null,
        p_details: null,
        p_responsible: null,
        p_start: null,
        p_end: null,
        p_quotation: null,
      },
    ],
    [
      'save_job_appointment',
      {
        p_account: null,
        p_deal: null,
        p_handoff: null,
        p_actor: null,
        p_responsible: null,
        p_start: null,
        p_end: null,
        p_revision: null,
      },
    ],
  ]) {
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null);
    if (response.status !== 403 || result?.code !== '42501')
      throw new Error(
        'Database preflight failed for calendar booking authorization. Apply migration 097 and refresh the schema cache.'
      );
  }

  const images = await fetchImpl(
    new URL(
      '/rest/v1/quotation_images?select=storage_path,quotation_id,account_id,image,ready,deleting,created_at&limit=0',
      url
    ),
    { headers, signal: AbortSignal.timeout(15000) }
  );
  if (!images.ok)
    throw new Error(
      'Database preflight failed for quotation pictures. Apply migration 098 before deploying this revision.'
    );
  const imageDetails = await fetchImpl(
    new URL('/rest/v1/rpc/quotation_document_details_valid', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p: {
          referenceImage: {
            storagePath:
              '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001.jpg',
            mimeType: 'image/jpeg',
            bytes: 123,
            width: 640,
            height: 480,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (
    !imageDetails.ok ||
    (await imageDetails.json().catch(() => false)) !== true
  )
    throw new Error(
      'Database preflight failed for quotation picture validation. Apply migration 098 before deploying this revision.'
    );
  const imageReady = await fetchImpl(
    new URL('/rest/v1/rpc/quotation_images_ready', url),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!imageReady.ok || (await imageReady.json().catch(() => false)) !== true)
    throw new Error(
      'Database preflight failed for quotation picture storage/permissions. Apply migration 098 before deploying this revision.'
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
