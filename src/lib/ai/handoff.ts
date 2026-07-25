import type { ChatMessage } from './types'

/** Longest the quoted customer message runs before we ellipsize it —
 *  keeps the internal note to a glanceable one-liner. */
const MAX_QUOTE_LEN = 160

/**
 * Build the short internal note the auto-reply bot leaves on a
 * conversation when it hands off to a human. Deterministic — composed
 * from context we already have (no extra LLM call / token spend), so it
 * can't fail or add latency to the handoff.
 *
 * Reads as, e.g.:
 *   "🤖 AI agent handed off after 2 replies. Last customer message:
 *    “can I speak to a manager about my refund?”"
 *
 * `replyCount` is the bot's auto-reply tally for the thread (0 when it
 * bailed on the very first inbound without answering).
 */
export function buildHandoffSummary(args: {
  messages: ChatMessage[]
  replyCount: number
  /** Lead details collected so far (see `listCollectedFieldValues`),
   * folded into the note as a real recap instead of just a tally. */
  collectedFields?: { name: string; value: string }[]
}): string {
  const { messages, replyCount, collectedFields } = args

  const lastCustomer = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim())

  const replies =
    replyCount === 0
      ? 'without replying'
      : `after ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`

  const parts = [`🤖 AI agent handed off ${replies}.`]

  if (collectedFields && collectedFields.length > 0) {
    parts.push(
      `Collected: ${collectedFields.map((f) => `${f.name}: ${f.value}`).join(', ')}.`,
    )
  }

  if (lastCustomer) {
    const quote = truncate(lastCustomer.content.trim(), MAX_QUOTE_LEN)
    parts.push(`Last customer message: “${quote}”`)
  }

  return parts.join(' ')
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
