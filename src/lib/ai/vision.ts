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
const GEMINI_VISION_MODEL = 'gemini-3.5-flash'

const DESCRIBE_PROMPT_BASE =
  'Describe what is shown in this photo in one short, factual sentence, for a customer-service context at a business that sells and installs doors, gates, shutters, and related hardware (motors/power units, remotes, control boxes, rails, tracks). ' +
  'When a specific component like that is visible, name it rather than only describing the overall door/shutter (e.g. "A roller shutter motor/power unit mounted above the door, with an attached control box." rather than just "A closed beige metal roller."). Do not guess brand names or prices.'

/**
 * Appended only when recent conversation text is available -- steers the
 * description toward what's actually relevant to the customer's request
 * (e.g. calling out a motor/control box because they asked about a motor
 * replacement) instead of a generic caption that ignores why the photo
 * was sent at all. Kept separate from the base prompt so a "describe
 * this thing" caption is still produced even without context.
 */
function buildContextClause(conversationContext: string): string {
  return (
    '\n\nRecent conversation so far, for context only (do not quote it back, just use it to judge what in the photo matters to the customer): \n' +
    conversationContext +
    '\n\nIf a specific detail in the photo is clearly relevant to what the customer is asking about above, add one short second sentence pointing it out; otherwise the one description sentence is enough. Never invent a connection that isn\'t actually visible in the photo.'
  )
}

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
  /** Recent conversation text (customer + business turns), best-effort
   * and optional -- lets the description reason about relevance to what
   * the customer is actually asking for instead of captioning the photo
   * in isolation. */
  conversationContext?: string
}): Promise<string> {
  const { provider, apiKey, imageBuffer, mimeType, conversationContext } = args
  const timeoutMs = aiRequestTimeoutMs()
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`
  const promptText = conversationContext
    ? DESCRIBE_PROMPT_BASE + buildContextClause(conversationContext)
    : DESCRIBE_PROMPT_BASE

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
              { type: 'text', text: promptText },
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
