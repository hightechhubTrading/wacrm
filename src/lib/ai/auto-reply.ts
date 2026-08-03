import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { listProductsForPrompt, getProductMediaItem } from './media-library'
import { generateReply } from './generate'
import {
  buildSystemPrompt,
  isArabicText,
  HANDOFF_CLOSING_MESSAGE_EN,
  HANDOFF_CLOSING_MESSAGE_AR,
} from './defaults'
import { buildHandoffSummary, notifyAiHandoff } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText, engineSendMedia } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import {
  listAiCollectibleFields,
  applyCollectedFields,
  listCollectedFieldValues,
  resolveCurrentOpenDeal,
  listGroupFieldsForStage,
} from './collect-fields'
import { AiError } from './types'
import type { AiConfig } from './types'
import { recordKeyError, clearKeyError, notifyAdminsOfKeyError } from './key-health'
import { isWithinBusinessHours, type BusinessHours } from './business-hours'
import { notifyUrgentLead } from './lead-priority'

/** How long a cached after-hours context summary stays fresh before
 * it's regenerated -- bounds the extra LLM call to at most once per
 * conversation per window, not once per reply. */
const CONTEXT_SUMMARY_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Mirror the rolling AI conversation summary onto the contact's Notes
 * list (contact_notes, migration 055) so it's visible right where an
 * agent is actually reading -- the inbox sidebar -- not just the
 * after-hours banner. One row per conversation, updated in place on
 * each refresh (via the `is_ai_generated` marker) rather than
 * appended, so the Notes list doesn't fill up with stale duplicates.
 */
async function upsertAiSummaryNote(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    conversationId: string
    authorUserId: string
    summary: string
  },
): Promise<void> {
  const { accountId, contactId, conversationId, authorUserId, summary } = args
  const noteText = `🤖 AI summary: ${summary}`
  const { data: existing } = await db
    .from('contact_notes')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('is_ai_generated', true)
    .maybeSingle()
  if (existing) {
    await db.from('contact_notes').update({ note_text: noteText }).eq('id', existing.id)
  } else {
    await db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      user_id: authorUserId,
      note_text: noteText,
      is_ai_generated: true,
    })
  }
}

interface DispatchArgs {
  /** Tenancy key -- drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   * audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws -- a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any -> silent no-op):
 * - AI off / auto-reply disabled for the account
 * - a human agent is assigned (they own the thread)
 * - auto-reply was disabled for this conversation (prior handoff)
 * - the per-conversation reply cap is reached (0 = unlimited)
 * - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here -- we're
 * reacting to a customer message that just landed -- so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  // Hoisted above the try so the catch block (key-error recording)
  // can still see them -- variables declared inside `try` aren't
  // visible in its `catch`.
  const db = supabaseAdmin()
  let config: AiConfig | null = null

  try {
    config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM -- the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count -- they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_context_summary, ai_context_summary_at, ai_priority',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return

    // Account-level business knowledge -- social links (shared with the
    // customer when asked) and business hours (after-hours takeover
    // below). One cheap point lookup by primary key; negligible next to
    // an LLM call, so no reason to gate it behind afterHoursTakeoverEnabled.
    const { data: account } = await db
      .from('accounts')
      .select('business_hours, timezone, social_links')
      .eq('id', accountId)
      .maybeSingle()
    const socialLinks = (account?.social_links as Record<string, string> | null) ?? null

    // After-hours takeover: outside the account's configured business
    // hours, AI keeps replying even though a human is assigned -- they
    // presumably aren't available either, and the point is the customer
    // never waits until morning for a first response.
    let isAfterHoursTakeover = false
    if (
      conv.assigned_agent_id &&
      config.afterHoursTakeoverEnabled &&
      account &&
      !isWithinBusinessHours(account.business_hours as BusinessHours | null, account.timezone)
    ) {
      isAfterHoursTakeover = true
    }
    if (conv.assigned_agent_id && !isAfterHoursTakeover) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here — still respected even after hours
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound). 0 (or less) means
    // unlimited -- the cap is opt-in.
    if (
      config.autoReplyMaxPerConversation > 0 &&
      conv.ai_reply_count >= config.autoReplyMaxPerConversation
    )
      return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Rolling conversation summary: regenerated at most once per TTL
    // window (never on every reply), for every conversation -- not
    // just after-hours takeover. Gives the model continuity on a
    // long-running thread beyond the normal message window (fed into
    // its own prompt only during after-hours takeover, see
    // buildSystemPrompt below), and is mirrored onto the contact's
    // Notes list so a human agent always has an up-to-date recap
    // without having to scroll the whole thread -- not just the
    // "AI handled this after hours" case (message-thread.tsx).
    let contextSummary: string | null = conv.ai_context_summary ?? null
    const summaryAge = conv.ai_context_summary_at
      ? Date.now() - new Date(conv.ai_context_summary_at).getTime()
      : Infinity
    if (summaryAge > CONTEXT_SUMMARY_TTL_MS) {
      try {
        const { text: summaryText } = await generateReply({
          config,
          systemPrompt:
            "Summarize this WhatsApp conversation in 2-3 short sentences for a teammate catching up: what the customer wants, what's been resolved, what's still outstanding. Output only the summary, no preamble.",
          messages,
        })
        if (summaryText.trim()) {
          contextSummary = summaryText.trim()
          await db
            .from('conversations')
            .update({
              ai_context_summary: contextSummary,
              ai_context_summary_at: new Date().toISOString(),
            })
            .eq('id', conversationId)
          await upsertAiSummaryNote(db, {
            accountId,
            contactId,
            conversationId,
            authorUserId: configOwnerUserId,
            summary: contextSummary,
          })
        }
      } catch (err) {
        console.error('[ai auto-reply] context summary generation failed:', err)
      }
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit -> skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit -- skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Media library -- lets the model attach a product photo/catalog by
    // id, and/or flag a product as the topic via a tag (best-effort;
    // empty when the account hasn't set one up, in which case
    // buildSystemPrompt omits the whole capability).
    const media = await listProductsForPrompt(db, accountId)

    // AI-collectible fields -- lets the model save lead details (product
    // interest, measurements, budget, timeline, etc.) onto the contact as
    // it learns them (best-effort; empty when the account hasn't opted
    // any fields in, in which case buildSystemPrompt omits the whole
    // capability). Group fields are added on top, but only when the
    // contact's current open deal has actually reached a stage with an
    // active custom field group linked -- never for a brand-new lead.
    const contactCollectFields = await listAiCollectibleFields(db, accountId)
    const currentDeal = await resolveCurrentOpenDeal(db, accountId, contactId)
    const groupCollectFields = currentDeal
      ? await listGroupFieldsForStage(db, currentDeal.stage_id)
      : []
    const collectFields = [...contactCollectFields, ...groupCollectFields]

    // Assigned agent's phone -- so the model can share a real callable
    // number when the customer asks to talk by phone, instead of
    // inventing one or just deflecting (migration 052).
    let assignedAgentPhone: string | null = null
    if (conv.assigned_agent_id) {
      const { data: agentProfile } = await db
        .from('profiles')
        .select('phone')
        .eq('user_id', conv.assigned_agent_id)
        .maybeSingle()
      assignedAgentPhone = (agentProfile?.phone as string | null) ?? null
    }

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      media,
      collectFields,
      contextSummary: isAfterHoursTakeover ? contextSummary : null,
      socialLinks,
      assignedAgentPhone,
    })

    const { text, handoff, mediaId, productTagId, fields, priority, priorityReason, usage } =
      await generateReply({
        config,
        systemPrompt,
        messages,
      })

    // The call just succeeded -- if the key was previously flagged as
    // broken, clear it. Best-effort: never let this block the reply.
    if (config.lastKeyError) {
      clearKeyError(db, accountId).catch((err) =>
        console.error('[ai auto-reply] failed to clear key error:', err),
      )
    }

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff -- the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Always persist the priority assessment (even 'low'/'normal') so
    // the conversation list shows a complete, honest signal rather than
    // only ever surfacing flagged rows. Best-effort; never blocks the
    // reply. Notify only on a genuine transition INTO urgent, not on
    // every subsequent urgent-flagged reply in the same thread.
    if (priority) {
      const becameUrgent = priority === 'urgent' && conv.ai_priority !== 'urgent'
      try {
        await db
          .from('conversations')
          .update({ ai_priority: priority, ai_priority_reason: priorityReason })
          .eq('id', conversationId)
        if (becameUrgent) {
          notifyUrgentLead(db, {
            accountId,
            conversationId,
            contactId,
            assignedAgentId: conv.assigned_agent_id ?? null,
            reason: priorityReason,
          }).catch((err) => console.error('[ai auto-reply] urgent notification failed:', err))
        }
      } catch (err) {
        console.error('[ai auto-reply] priority update failed:', err)
      }
    }

    if (handoff || !text) {
      // Best-effort: the model may have recorded lead details in the
      // same turn it decided to hand off -- capture them before the
      // thread goes quiet.
      if (fields && fields.length > 0) {
        try {
          await applyCollectedFields({ db, accountId, contactId, fields })
        } catch (err) {
          console.error('[ai auto-reply] field collection before handoff failed:', err)
        }
      }

      // Let the customer know a person is taking over instead of the
      // thread simply going quiet. This closing message is a fixed,
      // human-authored line -- never the model's own text, so a
      // handoff can never go out silently or with a message the model
      // forgot to write -- picked by the customer's own language.
      // Best-effort; a send failure here must not block the handoff.
      const closingMessage = isArabicText(latestUserMessage(messages))
        ? HANDOFF_CLOSING_MESSAGE_AR
        : HANDOFF_CLOSING_MESSAGE_EN
      try {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: closingMessage,
          aiGenerated: true,
        })
      } catch (err) {
        console.error('[ai auto-reply] handoff closing message failed:', err)
      }

      // The model can't (or shouldn't) answer -- stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent -- null leaves it in the shared queue --
      // and (c) leave a short internal note -- a real recap of whatever
      // lead details have been collected so far, not just a tally --
      // so whoever picks it up has context.
      const collectedFields = await listCollectedFieldValues(db, accountId, contactId)
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
        collectedFields,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned -- never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)

      // Explicitly notify a human -- never rely solely on the generic
      // `on_conversation_assigned` trigger (it fires too when the update
      // above just set assigned_agent_id, but under this service-role
      // client it can't say the assignment came from the AI or why).
      // Best-effort; a notification failure must not undo the handoff
      // above, which has already happened.
      try {
        await notifyAiHandoff(db, {
          accountId,
          conversationId,
          contactId,
          assignedAgentId: (update.assigned_agent_id as string | undefined) ?? conv.assigned_agent_id ?? null,
          summary,
        })
      } catch (err) {
        console.error('[ai auto-reply] handoff notification failed:', err)
      }

      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands --
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue -- e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })

    // Best-effort media attach: the text reply already landed, so a
    // failure here must not surface as a dispatch failure -- it's logged
    // and swallowed. Never sends anything the model didn't explicitly
    // choose by a real, existing file id (getProductMediaItem returns
    // null for a deleted-mid-conversation or hallucinated id).
    if (mediaId) {
      try {
        const item = await getProductMediaItem(db, accountId, mediaId)
        if (item) {
          const {
            data: { publicUrl },
          } = db.storage.from('ai-media').getPublicUrl(item.storagePath)
          await engineSendMedia({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            kind: item.mediaKind,
            link: publicUrl,
            filename: item.mediaKind === 'document' ? (item.label || item.productName) : undefined,
          })
        } else {
          console.warn(
            `[ai auto-reply] model chose file id "${mediaId}" but it no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] media send failed:', err)
      }
    }

    // Best-effort product tag: independent of attaching a file -- the
    // model flags a product as clearly the topic of conversation by its
    // product id, and (if that item has a linked tag) we apply it
    // to the contact. Never blocks or fails the reply/attach above.
    if (productTagId) {
      try {
        const taggedProduct = media.find((m) => m.id === productTagId)
        if (taggedProduct?.tagId) {
          await addContactTagAndDispatch({
            db,
            accountId,
            contactId,
            tagId: taggedProduct.tagId,
          })
        } else {
          console.warn(
            `[ai auto-reply] model flagged product id "${productTagId}" but it has no linked tag or no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] product tag failed:', err)
      }
    }

    // Best-effort lead-detail capture: independent of media/tag --
    // whenever the model recorded lead details this turn, save them
    // onto the contact and mirror a summary onto the linked deal.
    if (fields && fields.length > 0) {
      try {
        await applyCollectedFields({ db, accountId, contactId, fields })
      } catch (err) {
        console.error('[ai auto-reply] field collection failed:', err)
      }
    }
  } catch (err) {
    if (err instanceof AiError && err.code === 'invalid_key') {
      const isFreshFailure = !config?.lastKeyError
      try {
        await recordKeyError(db, accountId, err.message)
        if (isFreshFailure) {
          await notifyAdminsOfKeyError(db, accountId, err.message)
        }
      } catch (recordErr) {
        console.error('[ai auto-reply] failed to record key error:', recordErr)
      }
    }
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
