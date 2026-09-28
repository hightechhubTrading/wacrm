import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * `messages[].referral` on a Cloud API inbound message. Present (usually
 * only on the first message) when the customer arrived by tapping a
 * Click-to-WhatsApp ad. `ctwa_clid` is a personal identifier: store it,
 * never log it, never send it to the browser.
 */
export interface WhatsAppReferral {
  source_type?: string
  source_id?: string
  source_url?: string
  headline?: string
  body?: string
  ctwa_clid?: string
  [key: string]: unknown
}

export interface RecordAttributionInput {
  accountId: string
  conversationId: string
  /** `messages[].from` */
  contactWaId: string
  /** wamid -- makes the insert idempotent across Meta's webhook retries. */
  messageId: string
  /** Message `timestamp` (unix seconds, as a string). */
  timestamp: string
  referral: WhatsAppReferral | undefined
}

export function isAdReferral(
  referral: WhatsAppReferral | undefined,
): referral is WhatsAppReferral & { ctwa_clid: string } {
  return (
    !!referral &&
    referral.source_type === 'ad' &&
    typeof referral.ctwa_clid === 'string' &&
    referral.ctwa_clid.length > 0
  )
}

/**
 * Store a CTWA attribution row and move the conversation's ad badge to
 * this click. Returns true when an ad referral was stored. Never throws:
 * a failure here must not block processing the customer's message.
 */
export async function recordCtwaAttribution(
  db: SupabaseClient,
  input: RecordAttributionInput,
): Promise<boolean> {
  const { referral } = input
  if (!isAdReferral(referral)) return false

  const ms = Number(input.timestamp) * 1000
  const clickedAt = new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString()

  try {
    const { error } = await db.from('ctwa_attributions').upsert(
      {
        account_id: input.accountId,
        conversation_id: input.conversationId,
        contact_wa_id: input.contactWaId,
        message_id: input.messageId,
        ctwa_clid: referral.ctwa_clid,
        ad_id: referral.source_id ?? null,
        headline: referral.headline ?? null,
        source_url: referral.source_url ?? null,
        raw_referral: referral,
        clicked_at: clickedAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    if (error) {
      console.error('[ctwa] failed to store attribution for conversation', input.conversationId, error.message)
      return false
    }

    const { error: convError } = await db
      .from('conversations')
      .update({
        ad_source_id: referral.source_id ?? null,
        ad_headline: referral.headline ?? null,
        ad_clicked_at: clickedAt,
      })
      .eq('id', input.conversationId)
      .or(`ad_clicked_at.is.null,ad_clicked_at.lte.${clickedAt}`)
    if (convError) {
      console.error('[ctwa] failed to badge conversation', input.conversationId, convError.message)
    }
    return true
  } catch (err) {
    console.error(
      '[ctwa] attribution error for conversation',
      input.conversationId,
      err instanceof Error ? err.message : 'unknown error',
    )
    return false
  }
}
