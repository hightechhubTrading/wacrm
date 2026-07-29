import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendWahaGroupText, sendWahaIndividualText, WahaSendError } from './waha-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

const baseArgs = {
  baseUrl: 'https://waha.example.com',
  apiKey: 'secret-key',
  session: 'default',
  chatId: '120363047483149991@g.us',
  text: 'Hello group',
}

describe('sendWahaGroupText', () => {
  it('posts to /api/sendText with the group chatId and X-Api-Key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWahaGroupText(baseArgs)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://waha.example.com/api/sendText')
    expect(opts.method).toBe('POST')
    expect(opts.headers['X-Api-Key']).toBe('secret-key')
    expect(JSON.parse(opts.body)).toEqual({
      session: 'default',
      chatId: '120363047483149991@g.us',
      text: 'Hello group',
    })
  })

  it('strips a trailing slash from base_url before appending the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await sendWahaGroupText({ ...baseArgs, baseUrl: 'https://waha.example.com/' })

    expect(fetchMock.mock.calls[0][0]).toBe('https://waha.example.com/api/sendText')
  })

  it('returns ok:false on a non-2xx response without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid API key'),
      } as unknown as Response),
    )

    const result = await sendWahaGroupText(baseArgs)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('401')
  })

  it('returns ok:false on a network failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')),
    )

    const result = await sendWahaGroupText(baseArgs)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('getaddrinfo ENOTFOUND')
  })
})

describe('sendWahaIndividualText', () => {
  const args = {
    baseUrl: 'https://waha.example.com',
    apiKey: 'secret-key',
    session: 'sarah-agent',
    toPhone: '+15551234567',
    text: 'Hi, this is Sarah!',
  }

  it('posts to /api/sendText with an individual @c.us chatId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWahaIndividualText(args)

    expect(result.ok).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://waha.example.com/api/sendText')
    expect(opts.headers['X-Api-Key']).toBe('secret-key')
    expect(JSON.parse(opts.body)).toEqual({
      session: 'sarah-agent',
      chatId: '15551234567@c.us',
      text: 'Hi, this is Sarah!',
    })
  })

  it('throws WahaSendError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('session not connected'),
      } as unknown as Response),
    )

    await expect(sendWahaIndividualText(args)).rejects.toThrow(WahaSendError)
    await expect(sendWahaIndividualText(args)).rejects.toThrow(/422/)
  })

  it('throws WahaSendError on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))

    await expect(sendWahaIndividualText(args)).rejects.toThrow(WahaSendError)
  })
})
