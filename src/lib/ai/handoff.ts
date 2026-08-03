import type { SupabaseClient } from '@supabase/supabase-js'
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

/**
 * Explicitly notify a human that the AI just handed off a
 * conversation -- own notification (migration 058's `ai_handoff`
 * type), not left to the generic `on_conversation_assigned` DB
 * trigger. That trigger fires too (if this handoff set
 * `assigned_agent_id` on a previously-unassigned thread), but its
 * text is a generic "Someone assigned you a conversation" -- since
 * the AI runs under the service-role client, `auth.uid()` is null
 * there and it can't say *why*. This one always says "AI handed off"
 * and includes the actual handoff summary, so the recipient has real
 * context without opening the conversation first. A little
 * redundancy with the generic trigger in that one case is an accepted
 * tradeoff for never leaving a handoff silent otherwise.
 *
 * Same recipient-resolution as `notifyUrgentLead` (lead-priority.ts):
 * the assigned agent if there is one, otherwise every admin/owner on
 * the account -- a handoff must never go unnoticed just because no
 * `handoff_agent_id` is configured. Best-effort: swallows its own
 * errors, never blocks the handoff itself.
 */
export async function notifyAiHandoff(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    assignedAgentId: string | null
    summary: string
  },
): Promise<void> {
  const { accountId, conversationId, contactId, assignedAgentId, summary } = args

  let recipientIds: string[]
  if (assignedAgentId) {
    recipientIds = [assignedAgentId]
  } else {
    const { data: admins, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('account_role', ['owner', 'admin'])
    if (error) {
      console.error('[ai handoff] admin lookup for handoff notice failed:', error)
      return
    }
    if (!admins) return
    recipientIds = admins.map((a: { user_id: string }) => a.user_id)
  }
  if (recipientIds.length === 0) return

  const rows = recipientIds.map((userId) => ({
    account_id: accountId,
    user_id: userId,
    type: 'ai_handoff' as const,
    conversation_id: conversationId,
    contact_id: contactId,
    title: 'AI assistant handed off a conversation',
    body: summary,
  }))
  const { error: insertError } = await db.from('notifications').insert(rows)
  if (insertError) console.error('[ai handoff] handoff notification insert failed:', insertError)
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
