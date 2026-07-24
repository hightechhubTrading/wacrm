import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL,
  MEDIA_SENTINEL_OPEN,
  MEDIA_SENTINEL_CLOSE,
  PRODUCT_TAG_SENTINEL_OPEN,
  PRODUCT_TAG_SENTINEL_CLOSE,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, mediaId, productTagId, usage }`.
 * The handoff sentinel can appear alone or trailing a partial reply;
 * either way we treat the turn as a handoff and strip the marker from
 * any remaining text. The media sentinel (`[[SEND_MEDIA:<id>]]`) and the
 * product-tag sentinel (`[[TAG_PRODUCT:<id>]]`) are parsed the same way,
 * independently of each other, and their ids extracted --
 * malformed/unclosed markers are left as plain text rather than guessed
 * at. `usage` is passed straight through (null when the provider didn't
 * report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  let text = raw.split(HANDOFF_SENTINEL).join('')

  let mediaId: string | null = null
  const openIdx = text.indexOf(MEDIA_SENTINEL_OPEN)
  if (openIdx !== -1) {
    const closeIdx = text.indexOf(
      MEDIA_SENTINEL_CLOSE,
      openIdx + MEDIA_SENTINEL_OPEN.length,
    )
    if (closeIdx !== -1) {
      const id = text
        .slice(openIdx + MEDIA_SENTINEL_OPEN.length, closeIdx)
        .trim()
      if (id) {
        mediaId = id
        text = text.slice(0, openIdx) + text.slice(closeIdx + MEDIA_SENTINEL_CLOSE.length)
      }
    }
  }

  let productTagId: string | null = null
  const tagOpenIdx = text.indexOf(PRODUCT_TAG_SENTINEL_OPEN)
  if (tagOpenIdx !== -1) {
    const tagCloseIdx = text.indexOf(
      PRODUCT_TAG_SENTINEL_CLOSE,
      tagOpenIdx + PRODUCT_TAG_SENTINEL_OPEN.length,
    )
    if (tagCloseIdx !== -1) {
      const id = text
        .slice(tagOpenIdx + PRODUCT_TAG_SENTINEL_OPEN.length, tagCloseIdx)
        .trim()
      if (id) {
        productTagId = id
        text =
          text.slice(0, tagOpenIdx) +
          text.slice(tagCloseIdx + PRODUCT_TAG_SENTINEL_CLOSE.length)
      }
    }
  }

  text = text.trim()
  return { text, handoff, mediaId, productTagId, usage }
}
