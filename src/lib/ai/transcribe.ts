import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Voice-note transcription (OpenAI Whisper).
//
// Reuses the account's embeddings_api_key — already a standalone,
// always-OpenAI credential independent of the main chat provider (see
// embeddings.ts). Whisper has no Anthropic/Gemini/DeepSeek equivalent
// wired up here, same reasoning as embeddings being OpenAI-only.
// ============================================================

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const WHISPER_MODEL = 'whisper-1'

interface TranscriptionResponse {
  text?: string
}

/**
 * Transcribe a single audio file. Throws `AiError` on provider/network
 * failure — callers (webhook processing) treat this as best-effort and
 * must never let a failure block message ingestion.
 */
export async function transcribeAudio(args: {
  apiKey: string
  audioBuffer: Buffer
  mimeType: string
}): Promise<string> {
  const { apiKey, audioBuffer, mimeType } = args
  const timeoutMs = aiRequestTimeoutMs()

  const form = new FormData()
  const extension = mimeType.split('/')[1]?.split(';')[0] || 'ogg'
  form.append(
    'file',
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
    `audio.${extension}`,
  )
  form.append('model', WHISPER_MODEL)

  let res: Response
  try {
    res = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI transcription', res)
  }

  const data = (await res.json().catch(() => null)) as TranscriptionResponse | null
  if (!data || typeof data.text !== 'string') {
    throw new AiError('Transcription response was malformed.', {
      code: 'transcription_malformed',
    })
  }
  return data.text
}
