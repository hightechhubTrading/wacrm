import type { ChatMessage } from './types'

/**
 * The text to retrieve knowledge against: the most recent customer
 * (`user`) turn in the conversation context. Falls back to the last
 * message of any role, then empty string. Shared by the draft route and
 * the auto-reply bot so both query the knowledge base the same way.
 */
export function latestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return messages.length > 0 ? messages[messages.length - 1].content : ''
}

/** Strips a trailing auto-generated `[Image: ...]` caption, if present
 * (see context.ts's message formatting: `"caption\n[Image: ...]"` for a
 * captioned photo, or bare `"[Image: ...]"` for an uncaptioned one). */
function stripTrailingImageCaption(content: string): string {
  return content.replace(/(?:^|\n)\[Image: [\s\S]*\]$/, '').trim()
}

/**
 * Like `latestUserMessage`, but for language detection specifically:
 * strips a trailing auto-generated image caption and skips a customer
 * turn that is ENTIRELY one -- an uncaptioned photo -- since that
 * caption is always English (vision.ts's DESCRIBE_PROMPT) regardless of
 * what language the conversation is actually in, and must never be
 * mistaken for the customer's own words. Without this, a customer who's
 * been writing Arabic the whole conversation but sends an uncaptioned
 * photo gets read as having just switched to English -- both by the
 * model (mitigated by buildSystemPrompt's own guidance) and by the
 * deterministic `correctReplyLanguageIfNeeded` backstop, which has no
 * prompt to fall back on and would otherwise wrongly conclude an
 * English reply already matches.
 *
 * Falls back to `latestUserMessage` (accepting a bare image caption as
 * a last resort) only when the customer has never typed anything else
 * at all -- at that point there's genuinely no other signal available.
 */
export function latestCustomerAuthoredMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const authored = stripTrailingImageCaption(messages[i].content)
    if (authored) return authored
  }
  return latestUserMessage(messages)
}
