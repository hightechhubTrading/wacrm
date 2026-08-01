import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { analyzeImage } from './vision'
import { AiError } from './types'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

function okResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  } as unknown as Response
}

describe('analyzeImage', () => {
  it('sends a base64 image_url content part to OpenAI', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: string }) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      expect(opts.headers.Authorization).toBe('Bearer sk-x')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('gpt-4o-mini')
      const content = body.messages[0].content
      expect(content[1].type).toBe('image_url')
      expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
      return okResponse('A grey sofa.')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await analyzeImage({
      provider: 'openai',
      apiKey: 'sk-x',
      imageBuffer: Buffer.from('fake-image'),
      mimeType: 'image/jpeg',
    })
    expect(text).toBe('A grey sofa.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the same request shape to Gemini', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { body: string }) => {
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      )
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('gemini-2.0-flash')
      return okResponse('A red chair.')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await analyzeImage({
      provider: 'gemini',
      apiKey: 'sk-gem',
      imageBuffer: Buffer.from('fake-image'),
      mimeType: 'image/png',
    })
    expect(text).toBe('A red chair.')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      } as unknown as Response),
    )
    await expect(
      analyzeImage({
        provider: 'openai',
        apiKey: 'sk-bad',
        imageBuffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('throws on a malformed response missing content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      } as unknown as Response),
    )
    await expect(
      analyzeImage({
        provider: 'openai',
        apiKey: 'sk-x',
        imageBuffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('wraps a network failure as an AiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(
      analyzeImage({
        provider: 'gemini',
        apiKey: 'sk-x',
        imageBuffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})
