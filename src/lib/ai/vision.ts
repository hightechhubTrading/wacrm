import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Photo/image analysis (migration 054).
//
// A separate, optional credential -- mirroring the embeddings_api_key/
// Whisper pattern -- rather than routing through the account's main
// provider or the 4 provider adapters/ChatMessage type. Only OpenAI and
// Gemini are offered: Anthropic vision needs different request-building
// not otherwise needed here, and DeepSeek has no vision model. Gemini
// is included specifically so an account can pick its cheaper tier.
//
// Fully standalone -- does not touch generateReply, ChatMessage,
// mergeConsecutive, or any of providers/{openai,anthropic,gemini,deepseek}.ts.
// ============================================================

const OPENAI_VISION_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_VISION_MODEL = 'gpt-4o-mini'

const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const GEMINI_VISION_MODEL = 'gemini-2.0-flash'

const DESCRIBE_PROMPT =
  'Describe what is shown in this photo in one short, factual sentence, for a customer-service context (e.g. "A grey L-shaped fabric sofa in a living room."). Do not guess brand names or prices. Output only the description, nothing else.'

interface VisionChatResponse {
  choices?: { message?: { content?: string } }[]
}

/**
 * Describe a single inbound photo. Throws `AiError` on provider/network
 * failure -- callers (webhook processing) treat this as best-effort and
 * must never let a failure block message ingestion.
 */
export async function analyzeImage(args: {
  provider: 'openai' | 'gemini'
  apiKey: string
  imageBuffer: Buffer
  mimeType: string
}): Promise<string> {
  const { provider, apiKey, imageBuffer, mimeType } = args
  const timeoutMs = aiRequestTimeoutMs()
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`

  const url = provider === 'openai' ? OPENAI_VISION_URL : GEMINI_VISION_URL
  const model = provider === 'openai' ? OPENAI_VISION_MODEL : GEMINI_VISION_MODEL
  const providerLabel = provider === 'openai' ? 'OpenAI vision' : 'Gemini vision'

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DESCRIBE_PROMPT },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          },
        ],
        max_tokens: 128,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(providerLabel, res)
  }

  const data = (await res.json().catch(() => null)) as VisionChatResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${providerLabel} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  return text.trim()
}
