import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { listMediaLibraryForPrompt, getMediaLibraryItem } from './media-library'
import { generateReply } from './generate'
import {
  buildSystemPrompt,
  isArabicText,
  HANDOFF_CLOSING_MESSAGE_EN,
  HANDOFF_CLOSING_MESSAGE_AR,
} from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText, engineSendMedia } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import {
  listAiCollectibleFields,
  applyCollectedFields,
  listCollectedFieldValues,
} from './collect-fields'

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

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
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
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
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
    const media = await listMediaLibraryForPrompt(db, accountId)

    // AI-collectible custom fields -- lets the model save lead details
    // (product interest, measurements, budget, timeline, etc.) onto the
    // contact as it learns them (best-effort; empty when the account
    // hasn't opted any fields in, in which case buildSystemPrompt omits
    // the whole capability).
    const collectFields = await listAiCollectibleFields(db, accountId)

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      media,
      collectFields,
    })

    const { text, handoff, mediaId, productTagId, fields, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

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

    if (handoff || !text) {
      // Best-effort: the model may have recorded lead details in the
      // same turn it decided to hand off -- capture them before the
      // thread goes quiet.
      if (fields && fields.length > 0) {
        try {
          await applyCollectedFields({ db, accountId, contactId, conversationId, fields })
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
      // so whoever picks it up has context. Assigning fires the
      // `on_conversation_assigned` trigger, which notifies the agent.
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
    // choose by a real, existing library id (getMediaLibraryItem returns
    // null for a deleted-mid-conversation or hallucinated id).
    if (mediaId) {
      try {
        const item = await getMediaLibraryItem(db, accountId, mediaId)
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
            filename: item.mediaKind === 'document' ? item.name : undefined,
          })
        } else {
          console.warn(
            `[ai auto-reply] model chose media id "${mediaId}" but it no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] media send failed:', err)
      }
    }

    // Best-effort product tag: independent of attaching a file -- the
    // model flags a product as clearly the topic of conversation by its
    // media-library id, and (if that item has a linked tag) we apply it
    // to the contact. Never blocks or fails the reply/attach above.
    if (productTagId) {
      try {
        const taggedItem = media.find((m) => m.id === productTagId)
        if (taggedItem?.tagId) {
          await addContactTagAndDispatch({
            db,
            accountId,
            contactId,
            tagId: taggedItem.tagId,
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
        await applyCollectedFields({ db, accountId, contactId, conversationId, fields })
      } catch (err) {
        console.error('[ai auto-reply] field collection failed:', err)
      }
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
