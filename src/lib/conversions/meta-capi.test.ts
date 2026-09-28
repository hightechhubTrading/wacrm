import { describe, expect, it, vi } from 'vitest'
import { buildCapiPayload, postCapiEvent, readCapiConfig, type CapiConfig } from './meta-capi'

const env = {
  META_CAPI_ENABLED: 'true',
  META_DATASET_ID: 'ds-1',
  META_WABA_ID: 'waba-1',
  META_CAPI_ACCESS_TOKEN: 'tok',
  GRAPH_API_VERSION: 'v24.0',
}
const cfg: CapiConfig = { datasetId: 'ds-1', wabaId: 'waba-1', accessToken: 'tok', graphVersion: 'v24.0' }

describe('readCapiConfig', () => {
  it('returns config when enabled and complete', () => {
    expect(readCapiConfig(env)).toEqual(cfg)
  })
  it('includes the test event code only when set', () => {
    expect(readCapiConfig({ ...env, META_TEST_EVENT_CODE: 'TEST123' })?.testEventCode).toBe('TEST123')
  })
  it('returns null when the flag is off or anything is missing', () => {
    expect(readCapiConfig({ ...env, META_CAPI_ENABLED: 'false' })).toBeNull()
    expect(readCapiConfig({ ...env, META_CAPI_ENABLED: undefined })).toBeNull()
    expect(readCapiConfig({ ...env, META_CAPI_ACCESS_TOKEN: '' })).toBeNull()
    expect(readCapiConfig({ ...env, META_DATASET_ID: undefined })).toBeNull()
  })
  it('adds a missing v prefix to the Graph version', () => {
    expect(readCapiConfig({ ...env, GRAPH_API_VERSION: '24.0' })?.graphVersion).toBe('v24.0')
  })
})

describe('buildCapiPayload', () => {
  const base = {
    meta_event_name: 'Purchase',
    event_id: 'conv-1:won',
    tagged_at: '2025-09-28T09:00:00.000Z',
    stage: 'won' as const,
    value: '45000.00',
    currency: 'QAR',
  }

  it('matches the Meta schema exactly for Purchase', () => {
    expect(buildCapiPayload(base, 'ARAkLkA8rmlFeiCkt', cfg)).toEqual({
      data: [
        {
          event_name: 'Purchase',
          event_time: 1759050000,
          event_id: 'conv-1:won',
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          user_data: { whatsapp_business_account_id: 'waba-1', ctwa_clid: 'ARAkLkA8rmlFeiCkt' },
          custom_data: { currency: 'QAR', value: 45000 },
        },
      ],
    })
  })

  it('omits custom_data for non-Purchase stages and adds test_event_code when configured', () => {
    const payload = buildCapiPayload(
      { ...base, meta_event_name: 'QualifiedLead', event_id: 'conv-1:qualified', stage: 'qualified', value: null, currency: null },
      'clid',
      { ...cfg, testEventCode: 'TEST123' },
    )
    expect(payload.data[0]).not.toHaveProperty('custom_data')
    expect(payload.test_event_code).toBe('TEST123')
  })
})

describe('postCapiEvent', () => {
  const payload = { data: [] }

  it('posts to the dataset events endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace' }), { status: 200 }),
    )
    const result = await postCapiEvent(payload, cfg, fetchImpl)
    expect(result).toEqual({ ok: true, response: { events_received: 1, fbtrace_id: 'trace' } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v24.0/ds-1/events')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  it('returns Meta error message and code on 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid parameter', code: 100, error_subcode: 2804 } }), { status: 400 }),
    )
    await expect(postCapiEvent(payload, cfg, fetchImpl)).resolves.toEqual({
      ok: false,
      error: 'Invalid parameter (code 100/2804)',
    })
  })

  it('returns a network error instead of throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    await expect(postCapiEvent(payload, cfg, fetchImpl)).resolves.toEqual({ ok: false, error: 'fetch failed' })
  })
})
