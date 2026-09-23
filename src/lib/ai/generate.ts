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
  FIELD_SENTINEL_OPEN,
  FIELD_SENTINEL_CLOSE,
  PRIORITY_SENTINEL_OPEN,
  PRIORITY_SENTINEL_CLOSE,
  PRIORITY_LEVELS,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateGemini } from './providers/gemini'
import { generateDeepseek } from './providers/deepseek'

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
    case 'gemini':
      result = await generateGemini(providerArgs)
      break
    case 'deepseek':
      result = await generateDeepseek(providerArgs)
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
 * Removes every closed `open...close` marker from `text` and returns the
 * first non-empty id among them. An unclosed marker is left as plain
 * text rather than guessed at.
 */
function extractMarkers(
  text: string,
  open: string,
  close: string,
): { text: string; id: string | null } {
  let id: string | null = null
  let searchFrom = 0
  for (;;) {
    const openIdx = text.indexOf(open, searchFrom)
    if (openIdx === -1) break
    const closeIdx = text.indexOf(close, openIdx + open.length)
    if (closeIdx === -1) break
    const inner = text.slice(openIdx + open.length, closeIdx).trim()
    if (inner && id === null) id = inner
    text = text.slice(0, openIdx) + text.slice(closeIdx + close.length)
    searchFrom = openIdx
  }
  return { text, id }
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

  // Every media / product-tag marker is stripped from the text, not
  // just the first -- the model sometimes emits two media markers
  // ("Australian: [..] American: [..]") or an empty `[[TAG_PRODUCT:]]`,
  // and anything left behind went out to the customer verbatim. The
  // first non-empty id of each kind wins (at most one file is attached).
  const media = extractMarkers(text, MEDIA_SENTINEL_OPEN, MEDIA_SENTINEL_CLOSE)
  text = media.text
  const mediaId = media.id

  const tag = extractMarkers(text, PRODUCT_TAG_SENTINEL_OPEN, PRODUCT_TAG_SENTINEL_CLOSE)
  text = tag.text
  const productTagId = tag.id

  const fields: { name: string; value: string }[] = []
  let fieldSearchFrom = 0
  for (;;) {
    const openIdx = text.indexOf(FIELD_SENTINEL_OPEN, fieldSearchFrom)
    if (openIdx === -1) break
    const closeIdx = text.indexOf(FIELD_SENTINEL_CLOSE, openIdx + FIELD_SENTINEL_OPEN.length)
    if (closeIdx === -1) break
    const inner = text.slice(openIdx + FIELD_SENTINEL_OPEN.length, closeIdx)
    const eqIdx = inner.indexOf('=')
    if (eqIdx > 0) {
      const name = inner.slice(0, eqIdx).trim()
      const value = inner.slice(eqIdx + 1).trim()
      if (name && value) fields.push({ name, value })
    }
    text = text.slice(0, openIdx) + text.slice(closeIdx + FIELD_SENTINEL_CLOSE.length)
    fieldSearchFrom = openIdx
  }

  let priority: string | null = null
  let priorityReason: string | null = null
  const priorityOpenIdx = text.indexOf(PRIORITY_SENTINEL_OPEN)
  if (priorityOpenIdx !== -1) {
    const priorityCloseIdx = text.indexOf(
      PRIORITY_SENTINEL_CLOSE,
      priorityOpenIdx + PRIORITY_SENTINEL_OPEN.length,
    )
    if (priorityCloseIdx !== -1) {
      const inner = text.slice(
        priorityOpenIdx + PRIORITY_SENTINEL_OPEN.length,
        priorityCloseIdx,
      )
      const barIdx = inner.indexOf('|')
      const level = (barIdx === -1 ? inner : inner.slice(0, barIdx)).trim().toLowerCase()
      const reason = barIdx === -1 ? '' : inner.slice(barIdx + 1).trim()
      if ((PRIORITY_LEVELS as readonly string[]).includes(level)) {
        priority = level
        priorityReason = reason || null
      }
      text =
        text.slice(0, priorityOpenIdx) +
        text.slice(priorityCloseIdx + PRIORITY_SENTINEL_CLOSE.length)
    }
  }

  text = text.trim()
  return { text, handoff, mediaId, productTagId, fields, priority, priorityReason, usage }
}
