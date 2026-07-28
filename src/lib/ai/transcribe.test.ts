import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transcribeAudio } from './transcribe'
import { AiError } from './types'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('transcribeAudio', () => {
  it('sends the audio as multipart form data with the bearer key', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: FormData }) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
      expect(opts.headers.Authorization).toBe('Bearer sk-x')
      expect(opts.body.get('model')).toBe('whisper-1')
      const file = opts.body.get('file') as File
      expect(file).toBeTruthy()
      expect(file.name).toBe('audio.ogg')
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'hello there' }),
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeAudio({
      apiKey: 'sk-x',
      audioBuffer: Buffer.from('fake-audio'),
      mimeType: 'audio/ogg',
    })
    expect(text).toBe('hello there')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('derives the file extension from the mime type', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: FormData }) => {
      const file = opts.body.get('file') as File
      expect(file.name).toBe('audio.mp4')
      return { ok: true, status: 200, json: async () => ({ text: 'hi' }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await transcribeAudio({
      apiKey: 'sk-x',
      audioBuffer: Buffer.from('x'),
      mimeType: 'audio/mp4; codecs=mp4a',
    })
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
      transcribeAudio({ apiKey: 'sk-bad', audioBuffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
    ).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('throws on a malformed response missing text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response),
    )
    await expect(
      transcribeAudio({ apiKey: 'sk-x', audioBuffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('wraps a network failure as an AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )
    await expect(
      transcribeAudio({ apiKey: 'sk-x', audioBuffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
    ).rejects.toBeInstanceOf(AiError)
  })
})
