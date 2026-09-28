import type { ConversionEventRow } from './stages'

/**
 * Conversions API for Business Messaging (WhatsApp). Config comes from
 * env vars; `null` means "don't send" (flag off or incomplete), and the
 * outbox rows simply stay pending until it's configured.
 */
export interface CapiConfig {
  datasetId: string
  wabaId: string
  accessToken: string
  graphVersion: string
  testEventCode?: string
}

type Env = Record<string, string | undefined>

export function readCapiConfig(env: Env = process.env): CapiConfig | null {
  if (env.META_CAPI_ENABLED !== 'true') return null
  const datasetId = env.META_DATASET_ID?.trim()
  const wabaId = env.META_WABA_ID?.trim()
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim()
  const rawVersion = env.GRAPH_API_VERSION?.trim()
  if (!datasetId || !wabaId || !accessToken || !rawVersion) return null
  const graphVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
  const testEventCode = env.META_TEST_EVENT_CODE?.trim()
  return { datasetId, wabaId, accessToken, graphVersion, ...(testEventCode ? { testEventCode } : {}) }
}

export interface CapiPayload {
  data: Record<string, unknown>[]
  test_event_code?: string
}

export function buildCapiPayload(
  event: Pick<ConversionEventRow, 'meta_event_name' | 'event_id' | 'tagged_at' | 'stage' | 'value' | 'currency'>,
  ctwaClid: string,
  cfg: CapiConfig,
): CapiPayload {
  const data: Record<string, unknown> = {
    event_name: event.meta_event_name,
    event_time: Math.floor(Date.parse(event.tagged_at) / 1000),
    event_id: event.event_id,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: cfg.wabaId,
      // Sent unhashed, per Meta's business-messaging spec.
      ctwa_clid: ctwaClid,
    },
  }
  if (event.stage === 'won') {
    data.custom_data = { currency: event.currency ?? 'QAR', value: Number(event.value) }
  }
  const payload: CapiPayload = { data: [data] }
  if (cfg.testEventCode) payload.test_event_code = cfg.testEventCode
  return payload
}

export type CapiResult =
  | { ok: true; response: { events_received: unknown; fbtrace_id: unknown } }
  | { ok: false; error: string }

export async function postCapiEvent(
  payload: CapiPayload,
  cfg: CapiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CapiResult> {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(cfg.datasetId)}/events`
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => ({}))) as {
      events_received?: unknown
      fbtrace_id?: unknown
      error?: { message?: string; code?: number; error_subcode?: number }
    }
    if (res.ok) {
      return { ok: true, response: { events_received: body.events_received ?? null, fbtrace_id: body.fbtrace_id ?? null } }
    }
    const err = body.error
    if (!err) return { ok: false, error: `HTTP ${res.status}` }
    const code = `${err.code ?? res.status}${err.error_subcode ? `/${err.error_subcode}` : ''}`
    return { ok: false, error: `${err.message ?? 'Meta API error'} (code ${code})` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
