import { generateResilientReply } from './resilient-generation';
import { recordKnowledgeGap } from './knowledge-gaps';
import { createHash } from 'node:crypto';
import { sendTrackedMedia } from './media-actions';
import { productContext } from './product-context';
import { notifyReplyReview } from './reply-review';
import { turnBrief } from './conversation-behavior';
import { knowledgeQuery } from '@/lib/ai/query';
import {
  ensureFollowup,
  recordReplyEvent,
  type FollowupKind,
} from './followups';
import { loadConversationMemory, memoryPrompt } from './memory';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './admin-client';
import { loadAiConfig } from './config';
import { buildConversationContext } from './context';
import { retrieveKnowledge } from './knowledge';
import { listProductsForPrompt, getProductMediaItem } from './media-library';
import { generateReply } from './generate';
import {
  buildSystemPrompt,
  isArabicText,
  languageScript,
  containsPriceFigure,
  isolatePhoneNumbers,
  aiReplyDebounceMs,
  HANDOFF_CLOSING_MESSAGE_EN,
  HANDOFF_CLOSING_MESSAGE_AR,
} from './defaults';
import { buildHandoffSummary, notifyAiHandoff } from './handoff';
import { logAiUsage } from './usage';
import { latestCustomerAuthoredMessage, customerLanguageScript } from './query';
import { engineSendText, engineSendMedia } from '@/lib/flows/meta-send';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import {
  listAiCollectibleFields,
  applyCollectedFields,
  listCollectedFieldValues,
  resolveCurrentOpenDeal,
  listGroupFieldsForStage,
  type CurrentDeal,
} from './collect-fields';
import { AiError } from './types';
import type { AiConfig, ChatMessage } from './types';
import {
  recordKeyError,
  clearKeyError,
  notifyAdminsOfKeyError,
} from './key-health';
import {
  isWithinBusinessHours,
  formatBusinessHours,
  type BusinessHours,
} from './business-hours';
import { notifyUrgentLead } from './lead-priority';
import { assessSalesInput, verifySalesOutput } from './typesafe/sales';
import { jevMode } from './typesafe/client';
import { emotionalHandoffMessage } from './typesafe/emotion';

/** How long a cached after-hours context summary stays fresh before
 * it's regenerated -- bounds the extra LLM call to at most once per
 * conversation per window, not once per reply. */
const CONTEXT_SUMMARY_TTL_MS = 6 * 60 * 60 * 1000;

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
    accountId: string;
    contactId: string;
    conversationId: string;
    authorUserId: string;
    summary: string;
  }
): Promise<void> {
  const { accountId, contactId, conversationId, authorUserId, summary } = args;
  const noteText = `🤖 AI summary: ${summary}`;
  const { data: existing } = await db
    .from('contact_notes')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('is_ai_generated', true)
    .maybeSingle();
  if (existing) {
    await db
      .from('contact_notes')
      .update({ note_text: noteText })
      .eq('id', existing.id);
  } else {
    await db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      user_id: authorUserId,
      note_text: noteText,
      is_ai_generated: true,
    });
  }
}

/**
 * Actually perform a handoff: send the fixed closing message, disable
 * auto-reply on the thread, route it to a human, leave a real recap
 * note, and explicitly notify whoever should pick it up. Shared by
 * two triggers: (1) the model itself decided to hand off (or
 * produced no text), and (2) the deterministic reply-cap backstop
 * below, when the model never asked to hand off on its own and the
 * conversation would otherwise just go silently dead once the cap is
 * reached. Same path either way -- the customer and the team see
 * identical behavior regardless of which trigger fired.
 *
 * Never throws -- every side effect here is already independently
 * best-effort (matches the pre-extraction behavior); a failure in one
 * step must not skip the rest.
 */
async function performHandoff(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  configOwnerUserId: string;
  messages: ChatMessage[];
  replyCount: number;
  handoffAgentId: string | null;
  currentAssignedAgentId: string | null;
  /** Lead details the model recorded in the same turn it decided to
   * hand off -- captured before the thread goes quiet. Omitted by the
   * reply-cap backstop, which has no fresh model output to draw from. */
  fields?: { name: string; value: string }[];
  expectedDeal?: CurrentDeal | null;
  triggerMessageId?: string;
  followupKind?: FollowupKind;
  apologize?: boolean;
  handoffReason?: string;
  routingDecision?: { reason: string; failures: string[]; attempt: number };
}): Promise<void> {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    messages,
    replyCount,
    handoffAgentId,
    currentAssignedAgentId,
    fields,
  } = args;

  if (fields && fields.length > 0) {
    try {
      await applyCollectedFields({
        db,
        accountId,
        contactId,
        fields,
        ...('expectedDeal' in args ? { expectedDeal: args.expectedDeal } : {}),
      });
    } catch (err) {
      console.error(
        '[ai auto-reply] field collection before handoff failed:',
        err
      );
    }
  }

  await ensureFollowup(db, {
    accountId,
    conversationId,
    sourceMessageId: args.triggerMessageId,
    kind: args.followupKind ?? 'handoff',
    ownerId: currentAssignedAgentId ?? handoffAgentId,
  });
  // Let the customer know a person is taking over instead of the
  // thread simply going quiet. This closing message is a fixed,
  // human-authored line -- never the model's own text, so a handoff
  // can never go out silently or with a message the model forgot to
  // write -- picked by the customer's own language. Best-effort; a
  // send failure here must not block the handoff. Uses
  // latestCustomerAuthoredMessage, not latestUserMessage -- a handoff
  // triggered right after an uncaptioned photo must not read the
  // photo's always-English auto-caption as the customer having
  // switched languages.
  const customerScript = customerLanguageScript(messages);
  const defaultClosingMessage = args.apologize
    ? emotionalHandoffMessage(messages)
    : (
          customerScript === 'mixed'
            ? isArabicText(latestCustomerAuthoredMessage(messages))
            : customerScript === 'arabic'
        )
      ? HANDOFF_CLOSING_MESSAGE_AR
      : HANDOFF_CLOSING_MESSAGE_EN;
  const closingMessage =
    !args.apologize && args.followupKind === 'inspection'
      ? customerScript === 'arabic'
        ? 'طلب المعاينة يحتاج تنسيق الفريق. الموعد غير مؤكد بعد.'
        : 'Your inspection request needs team coordination. An appointment has not been confirmed yet.'
      : defaultClosingMessage;
  // Stop auto-replying on this thread and hand it to a human. We (a)
  // pause the bot here (sticky until re-enabled), (b) route the
  // conversation to the configured handoff agent -- null leaves it in
  // the shared queue -- and (c) leave a short internal note -- a real
  // recap of whatever lead details have been collected so far, not
  // just a tally -- so whoever picks it up has context.
  const collectedFields = await listCollectedFieldValues(
    db,
    accountId,
    contactId
  );
  const recap = buildHandoffSummary({
    messages,
    replyCount,
    collectedFields,
  });
  const summary = args.handoffReason ? `${recap} ${args.handoffReason}` : recap;
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: args.routingDecision
      ? `${summary} Routing: ${args.routingDecision.reason}; failed checks: ${args.routingDecision.failures.join(', ') || 'none'}; attempt: ${args.routingDecision.attempt}.`
      : summary,
    ai_handoff_reason: args.routingDecision ?? {
      reason: args.handoffReason ?? 'human_requested_or_reply_limit',
      failures: [],
      attempt: 0,
    },
  };
  // Only set the assignee when a target is configured AND the thread
  // isn't already owned -- never stomp an existing human assignment.
  if (handoffAgentId && !currentAssignedAgentId) {
    update.assigned_agent_id = handoffAgentId;
  }
  const { error: handoffError } = await db
    .from('conversations')
    .update(update)
    .eq('id', conversationId);
  if (handoffError) {
    await recordReplyEvent(db, {
      accountId,
      conversationId,
      triggerMessageId: args.triggerMessageId,
      outcome: 'failed',
      reason: 'handoff_failed',
    });
  } else {
    await recordReplyEvent(db, {
      accountId,
      conversationId,
      triggerMessageId: args.triggerMessageId,
      outcome: 'handoff',
      reason:
        args.routingDecision?.reason ??
        (args.followupKind === 'document_review'
          ? 'document_review'
          : 'handoff'),
    });

    try {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: closingMessage,
        aiGenerated: true,
      });
    } catch (err) {
      console.error('[ai auto-reply] handoff closing message failed:', err);
      await recordReplyEvent(db, {
        accountId,
        conversationId,
        triggerMessageId: args.triggerMessageId,
        outcome: 'failed',
        reason: 'handoff_closing_failed',
      });
    }
  }

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
      assignedAgentId:
        (update.assigned_agent_id as string | undefined) ??
        currentAssignedAgentId ??
        null,
      summary,
    });
  } catch (err) {
    console.error('[ai auto-reply] handoff notification failed:', err);
  }
}

/**
 * Deterministic backstop against a reply landing in the wrong language --
 * the prompt already instructs the model to mirror the customer's
 * language (see buildSystemPrompt), but that's a probabilistic
 * instruction competing against a lot of reference-material text
 * (knowledge base, product catalog, business-context prompt) that may
 * itself be in a different language. This check doesn't trust the
 * model's word for it: it compares scripts and, on a genuine mismatch,
 * runs one corrective translation call before the reply ever reaches
 * the customer.
 *
 * Only acts when both the customer's language and the reply are
 * clearly one script or the other (see `languageScript`, which ignores
 * URLs, numbers, units and product acronyms like "UPVC") -- genuinely
 * mixed content is common and legitimate in this account's bilingual
 * material, so it's left alone rather than risk a false correction.
 * Never throws; any failure here falls back to the original text
 * rather than blocking the send.
 */
async function correctReplyLanguageIfNeeded(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  config: AiConfig;
  customerScript: 'arabic' | 'latin' | 'mixed';
  replyText: string;
}): Promise<string> {
  const { db, accountId, conversationId, config, customerScript, replyText } =
    args;
  const replyScript = languageScript(replyText);
  if (
    customerScript === 'mixed' ||
    replyScript === 'mixed' ||
    customerScript === replyScript
  ) {
    return replyText;
  }

  const targetLanguage = customerScript === 'arabic' ? 'Arabic' : 'English';
  try {
    const { text: translated, usage } = await generateReply({
      config,
      systemPrompt:
        `The message below was about to be sent to a customer, but it is written in the wrong language -- translate it into ${targetLanguage} instead. ` +
        'Preserve the meaning, tone, and any numbers, product names, or URLs exactly -- do not add, remove, or answer anything new. ' +
        'Output ONLY the translated message text, nothing else.',
      messages: [{ role: 'user', content: replyText }],
    });
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'translate',
      provider: config.provider,
      model: config.model,
      usage,
    });
    if (translated.trim() && languageScript(translated) === customerScript) {
      return translated.trim();
    }
    console.warn(
      '[ai auto-reply] language correction did not land in the target script -- sending the original.'
    );
    return replyText;
  } catch (err) {
    console.error('[ai auto-reply] language correction call failed:', err);
    return replyText;
  }
}

interface DispatchArgs {
  /** Tenancy key -- drives config, contact, and whatsapp_config lookups. */
  accountId: string;
  conversationId: string;
  contactId: string;
  /** The account's WhatsApp config owner, used for the outbound send's
   * audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string;
  /** The just-arrived inbound message's WhatsApp id (`messages.message_id`).
   * Drives the debounce staleness check below -- omit only when calling
   * this function outside the webhook's per-message flow (e.g. tests
   * exercising the rest of the pipeline directly), which skips debouncing
   * entirely and replies immediately, matching the pre-debounce behavior. */
  triggerMessageId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the conversation's latest customer message is no longer
 * the one that triggered this invocation -- i.e. a later bubble in the
 * same burst has landed and its own invocation owns the reply. */
async function newerCustomerMessageArrived(
  db: SupabaseClient,
  conversationId: string,
  triggerMessageId: string | undefined
): Promise<boolean> {
  const { data: latestCustomerMessage } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .order('received_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    !!latestCustomerMessage &&
    latestCustomerMessage.message_id !== triggerMessageId
  );
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
  args: DispatchArgs
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    triggerMessageId,
  } = args;

  // Hoisted above the try so the catch block (key-error recording)
  // can still see them -- variables declared inside `try` aren't
  // visible in its `catch`.
  const db = supabaseAdmin();
  const startedAt = Date.now();
  const stageTimes: Record<string, number> = {};
  const replyMeta: Record<string, unknown> = {};
  let config: AiConfig | null = null;
  const event = (outcome: 'skipped' | 'sent' | 'failed', reason: string) =>
    recordReplyEvent(db, {
      accountId,
      conversationId,
      triggerMessageId,
      outcome,
      reason,
      ...(config?.behaviorV2Enabled
        ? {
            details: {
              stageMs: { ...stageTimes, total: Date.now() - startedAt },
              ...replyMeta,
            },
          }
        : {}),
    });

  try {
    config = await loadAiConfig(db, accountId);
    if (!config || !config.autoReplyEnabled) {
      await event('skipped', 'ai_disabled');
      return;
    }

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
      .limit(1);
    if (autoResponders && autoResponders.length > 0) {
      await event('skipped', 'automation_owned');
      return;
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_context_summary, ai_context_summary_at, ai_priority, ad_headline, ad_source_id'
      )
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr || !conv) {
      await event('failed', 'conversation_unavailable');
      return;
    }

    // Account-level business knowledge -- social links (shared with the
    // customer when asked) and business hours (after-hours takeover
    // below). One cheap point lookup by primary key; negligible next to
    // an LLM call, so no reason to gate it behind afterHoursTakeoverEnabled.
    const { data: account } = await db
      .from('accounts')
      .select('business_hours, timezone, social_links, default_currency')
      .eq('id', accountId)
      .maybeSingle();
    const socialLinks =
      (account?.social_links as Record<string, string> | null) ?? null;

    // Pause during business hours: the mirror image of after-hours
    // takeover below -- staff are presumably handling chats themselves
    // while the business is open, so AI stands down entirely (assigned
    // or not) until they're off. Only fires when hours are actually
    // configured -- isWithinBusinessHours() treats "unconfigured" as
    // always open, which would otherwise mean "always paused" here.
    const businessHours =
      (account?.business_hours as BusinessHours | null) ?? null;
    const hoursConfigured =
      !!businessHours && Object.keys(businessHours).length > 0;
    if (
      config.pauseDuringBusinessHours &&
      account &&
      hoursConfigured &&
      isWithinBusinessHours(businessHours, account.timezone)
    ) {
      await event('skipped', 'business_hours');
      return;
    }

    // After-hours takeover: outside the account's configured business
    // hours, AI keeps replying even though a human is assigned -- they
    // presumably aren't available either, and the point is the customer
    // never waits until morning for a first response.
    let isAfterHoursTakeover = false;
    if (
      conv.assigned_agent_id &&
      config.afterHoursTakeoverEnabled &&
      account &&
      !isWithinBusinessHours(businessHours, account.timezone)
    ) {
      isAfterHoursTakeover = true;
    }
    if (conv.assigned_agent_id && !isAfterHoursTakeover) {
      await event('skipped', 'human_owned');
      return;
    } // a human owns this thread
    if (conv.ai_autoreply_disabled) {
      await event('skipped', 'thread_paused');
      return;
    } // handed off / turned off here — still respected even after hours
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound). 0 (or less) means
    // unlimited -- the cap is opt-in.
    if (
      config.autoReplyMaxPerConversation > 0 &&
      conv.ai_reply_count >= config.autoReplyMaxPerConversation
    ) {
      // Deterministic backstop: don't let the conversation just go
      // silently dead because the LLM never emitted the handoff
      // sentinel on its own before running out of replies. Runs
      // through the exact same performHandoff path a model-initiated
      // handoff does, so the customer and the team see identical
      // behavior either way. This fires at most once -- the very next
      // inbound message hits `ai_autoreply_disabled` above and
      // returns before ever reaching this check again.
      const capMessages = await buildConversationContext(db, conversationId);
      if (capMessages.length > 0) {
        await performHandoff({
          db,
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
          messages: capMessages,
          routingDecision: { reason: 'reply_limit', failures: [], attempt: 0 },
          replyCount: conv.ai_reply_count ?? 0,
          handoffAgentId: config.handoffAgentId,
          currentAssignedAgentId: conv.assigned_agent_id,
          triggerMessageId,
        });
      }
      return;
    }

    // Debounce: a customer very commonly splits one thought across
    // several WhatsApp bubbles sent seconds apart (a burst). Without
    // this, each message in the burst triggered its own full reply --
    // disjointed, repetitive ("noted, X" three times over), and wasteful
    // of LLM spend since only the atomic slot claim below decides which
    // one actually sends. Instead: wait briefly, then check whether a
    // newer customer message has landed in the meantime. If so, bail out
    // silently -- that later message's own invocation will run this same
    // check, find itself still the latest, and reply on behalf of the
    // whole burst (buildConversationContext always reads the full
    // current thread, not just the triggering message). Net effect: only
    // the last message of a burst ever reaches the LLM call.
    // Skipped when triggerMessageId is absent (see DispatchArgs) or the
    // debounce window is configured to 0.
    const debounceMs = aiReplyDebounceMs();
    const debounceActive = !!triggerMessageId && debounceMs > 0;
    if (debounceActive) {
      await sleep(debounceMs);
      if (
        await newerCustomerMessageArrived(db, conversationId, triggerMessageId)
      ) {
        await event('skipped', 'stale_trigger');
        return; // a newer message arrived during the wait -- it owns the reply
      }
    }

    const messages = await buildConversationContext(db, conversationId);
    if (messages.length === 0) {
      await event('skipped', 'no_context');
      return;
    }

    // Jev never overrides the deterministic ownership/consent gates. Recheck
    // close to every effect because model calls can outlive a customer burst.
    const jevContext = {
      db,
      accountId,
      conversationId,
      triggerMessageId,
      workflow: 'auto_reply' as const,
      ...(config.behaviorV2Enabled
        ? {
            snapshot: {
              messageIds: messages.flatMap((m) =>
                m.sourceMessageId ? [m.sourceMessageId] : []
              ),
              configurationHash: createHash('sha256')
                .update(
                  JSON.stringify({
                    model: config.model,
                    facts: config.companyFacts,
                    instructions: config.companyFacts ?? config.systemPrompt,
                    behavior: config.behaviorV2Enabled,
                  })
                )
                .digest('hex'),
            },
          }
        : {}),
    };
    const stillEligible = async () => {
      if (jevMode() !== 'enforce') return true;
      if (
        triggerMessageId &&
        (await newerCustomerMessageArrived(
          db,
          conversationId,
          triggerMessageId
        ))
      )
        return false;
      const { data: fresh, error } = await db
        .from('conversations')
        .select('assigned_agent_id, ai_autoreply_disabled')
        .eq('id', conversationId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (error || !fresh || fresh.ai_autoreply_disabled) return false;
      // Even after hours, a new assignment means the old snapshot is stale.
      return fresh.assigned_agent_id === conv.assigned_agent_id;
    };

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit -> skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount
    );
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit -- skipping this inbound.`
      );
      await event('skipped', 'rate_limited');
      return;
    }

    const memory = await loadConversationMemory(
      db,
      accountId,
      conversationId,
      messages
    );
    const lastCustomer = [...messages].reverse().find((m) => m.role === 'user');
    if (
      lastCustomer?.attachmentState === 'unavailable' &&
      !config.behaviorV2Enabled
    ) {
      if (!(await stillEligible())) {
        await event('skipped', 'stale_trigger');
        return;
      }
      await performHandoff({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        messages,
        replyCount: conv.ai_reply_count ?? 0,
        handoffAgentId: config.handoffAgentId,
        currentAssignedAgentId: conv.assigned_agent_id,
        triggerMessageId,
        followupKind: 'document_review',
        routingDecision: {
          reason: 'attachment_unavailable',
          failures: [],
          attempt: 0,
        },
      });
      return;
    }
    const salesInput = await assessSalesInput(
      jevContext,
      messages,
      memory,
      config.behaviorV2Enabled
    );
    if (salesInput.handoff && (await stillEligible())) {
      for (const kind of salesInput.followupKinds ?? [])
        await ensureFollowup(db, {
          accountId,
          conversationId,
          sourceMessageId: triggerMessageId,
          kind,
          ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
        });
    }
    if (salesInput.handoff) {
      if (!(await stillEligible())) {
        await event('skipped', 'stale_trigger');
        return;
      }
      await performHandoff({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        messages,
        replyCount: conv.ai_reply_count ?? 0,
        handoffAgentId: config.handoffAgentId,
        currentAssignedAgentId: conv.assigned_agent_id,
        triggerMessageId,
        apologize: salesInput.apologize,
        handoffReason: salesInput.handoffReason,
        routingDecision: {
          reason: salesInput.apologize
            ? 'input_complaint_or_emotion'
            : 'explicit_human_request',
          failures: [],
          attempt: 0,
        },
      });
      return;
    }

    // Rolling conversation summary: regenerated at most once per TTL
    // window (never on every reply), for every conversation -- not
    // just after-hours takeover. Gives the model continuity on a
    // long-running thread beyond the normal message window (fed into
    // its own prompt only during after-hours takeover, see
    // buildSystemPrompt below), and is mirrored onto the contact's
    // Notes list so a human agent always has an up-to-date recap
    // without having to scroll the whole thread -- not just the
    // "AI handled this after hours" case (message-thread.tsx).
    const summaryConfig = config;
    const refreshStaffSummary = async () => {
      let contextSummary: string | null = conv.ai_context_summary ?? null;
      const summaryAge = conv.ai_context_summary_at
        ? Date.now() - new Date(conv.ai_context_summary_at).getTime()
        : Infinity;
      if (summaryAge > CONTEXT_SUMMARY_TTL_MS) {
        try {
          const { text: summaryText } = await generateReply({
            config: summaryConfig,
            systemPrompt:
              "Summarize this WhatsApp conversation in 2-3 short sentences for a teammate catching up: what the customer wants, what's been resolved, what's still outstanding. Output only the summary, no preamble.",
            messages,
          });
          if (summaryText.trim()) {
            contextSummary = summaryText.trim();
            await db
              .from('conversations')
              .update({
                ai_context_summary: contextSummary,
                ai_context_summary_at: new Date().toISOString(),
              })
              .eq('id', conversationId);
            await upsertAiSummaryNote(db, {
              accountId,
              contactId,
              conversationId,
              authorUserId: configOwnerUserId,
              summary: contextSummary,
            });
          }
        } catch (err) {
          console.error(
            '[ai auto-reply] context summary generation failed:',
            err
          );
        }
      }
    };

    // Ground the reply in the account's knowledge base (best-effort).
    const retrievalStarted = Date.now();
    const [knowledge, allProducts, contactCollectFields] = await Promise.all([
      retrieveKnowledge(
        db,
        accountId,
        config,
        knowledgeQuery(messages, config.behaviorV2Enabled)
      ),
      listProductsForPrompt(db, accountId),
      listAiCollectibleFields(db, accountId),
    ]);
    stageTimes.retrieval = Date.now() - retrievalStarted;
    const media = config.behaviorV2Enabled
      ? productContext(allProducts, knowledge, messages)
      : allProducts;

    const currentDeal = await resolveCurrentOpenDeal(db, accountId, contactId);
    const groupCollectFields = currentDeal
      ? await listGroupFieldsForStage(db, currentDeal.stage_id)
      : [];
    const collectFields = [...contactCollectFields, ...groupCollectFields];

    // Assigned agent's phone -- so the model can share a real callable
    // number when the customer asks to talk by phone, instead of
    // inventing one or just deflecting (migration 052).
    let assignedAgentPhone: string | null = null;
    if (conv.assigned_agent_id) {
      const { data: agentProfile } = await db
        .from('profiles')
        .select('phone')
        .eq('user_id', conv.assigned_agent_id)
        .maybeSingle();
      assignedAgentPhone = (agentProfile?.phone as string | null) ?? null;
    }

    const baseSystemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      companyFacts: config.companyFacts,
      behaviorV2Enabled: config.behaviorV2Enabled,
      mode: 'auto_reply',
      knowledge,
      media,
      collectFields,
      contextSummary: null, // Generated summaries are not verified source facts; use memory below.
      socialLinks,
      assignedAgentPhone,
      businessHours: formatBusinessHours(businessHours),
      timezone: account?.timezone ?? null,
    });

    const groundedSystemPrompt = `${baseSystemPrompt}\n\n${memoryPrompt(memory)}${config.behaviorV2Enabled ? '\n' + turnBrief(messages) : ''}`;
    const adReference =
      config.behaviorV2Enabled && conv.ad_headline
        ? '\nAdvertisement hint (not customer confirmation or verified product facts): ' +
          JSON.stringify({
            headline: conv.ad_headline,
            source: conv.ad_source_id,
          })
        : '';
    const systemPrompt = salesInput.guidance
      ? `${groundedSystemPrompt}\n\nSales communication guidance:\n${salesInput.guidance}${adReference}`
      : groundedSystemPrompt + adReference;

    const salesEvidence: import('./typesafe/sales').SalesEvidence = {
      intent: salesInput.intent,
      messages,
      knowledge,
      products: media,
      collectFields,
      businessContext: config.behaviorV2Enabled
        ? (config.companyFacts ?? null)
        : (config.companyFacts ?? config.systemPrompt),
      behaviorV2Enabled: config.behaviorV2Enabled,
      businessHours: formatBusinessHours(businessHours),
      socialLinks,
      agentPhone: assignedAgentPhone,
      currency: account?.default_currency ?? null,
      memory,
      emotion: salesInput.emotion,
    };
    const generationStarted = Date.now();
    const generated = await generateResilientReply(
      {
        config,
        systemPrompt,
        messages,
        ...(config.behaviorV2Enabled ? { deadlineAt: startedAt + 60000 } : {}),
      },
      salesEvidence
    );
    stageTimes.generation = Date.now() - generationStarted;
    const { priority, priorityReason, usage } = generated;
    let { text, handoff, mediaId, productTagId, fields } = generated;

    // Second debounce check, after generation. The first check only
    // covers the fixed wait; the summary + knowledge + LLM calls above
    // routinely take several more seconds, and a burst bubble landing
    // in that window used to get its own full reply on top of this one
    // (~10% of all AI replies over 30 days of real traffic went out
    // back-to-back, median 10s apart, often re-asking the same thing).
    // The newer message's own invocation sees the whole thread, so
    // dropping this reply loses nothing.
    if (
      debounceActive &&
      (await newerCustomerMessageArrived(db, conversationId, triggerMessageId))
    ) {
      await event('skipped', 'stale_trigger');
      return;
    }

    // The call just succeeded -- if the key was previously flagged as
    // broken, clear it. Best-effort: never let this block the reply.
    if (config.lastKeyError && !generated.providerUnavailable) {
      clearKeyError(db, accountId).catch((err) =>
        console.error('[ai auto-reply] failed to clear key error:', err)
      );
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
    });

    if (text && !handoff && !generated.fallbackId) {
      text = isolatePhoneNumbers(
        await correctReplyLanguageIfNeeded({
          db,
          accountId,
          conversationId,
          config,
          customerScript: customerLanguageScript(messages),
          replyText: text,
        })
      );
    }
    if (text && generated.fallbackId) text = isolatePhoneNumbers(text);
    const recoveryConfig = config;
    const verificationStarted = Date.now();
    const verified = await verifySalesOutput(
      jevContext,
      salesEvidence,
      {
        text,
        handoff,
        mediaId,
        productTagId,
        fields,
        priority,
        priorityReason,
        usage,
      },
      generated.providerUnavailable
        ? undefined
        : async (guidance) => {
            if (!(await stillEligible())) throw new Error('Superseded reply');
            const revised = await generateReply({
              config: recoveryConfig,
              ...(recoveryConfig.behaviorV2Enabled
                ? { deadlineAt: startedAt + 60000 }
                : {}),
              systemPrompt: `${systemPrompt}\n\nReply recovery:\n${guidance}`,
              messages,
            });
            void logAiUsage(db, {
              accountId,
              conversationId,
              mode: 'auto_reply',
              provider: recoveryConfig.provider,
              model: recoveryConfig.model,
              usage: revised.usage,
            });
            if (revised.text && !revised.handoff) {
              revised.text = isolatePhoneNumbers(
                await correctReplyLanguageIfNeeded({
                  db,
                  accountId,
                  conversationId,
                  config: recoveryConfig,
                  customerScript: customerLanguageScript(messages),
                  replyText: revised.text,
                })
              );
            }
            return revised;
          }
    );
    stageTimes.verification = Date.now() - verificationStarted;
    replyMeta.generation = verified.fallbackId
      ? 'approved_snippet'
      : 'provider';
    replyMeta.providerUnavailable = generated.providerUnavailable ?? false;
    if (verified.reviewRequired) {
      if (!(await stillEligible())) {
        await event('skipped', 'stale_trigger');
        return;
      }
      await ensureFollowup(db, {
        accountId,
        conversationId,
        sourceMessageId: triggerMessageId,
        kind: 'handoff',
        ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
      });
      await event(
        'failed',
        verified.routingDecision?.reason ?? 'reply_needs_review'
      );
      await notifyReplyReview(db, {
        accountId,
        conversationId,
        contactId,
        ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
        reason: verified.routingDecision?.reason ?? 'reply_needs_review',
      });
      return;
    }
    text = verified.text;
    handoff = verified.handoff;
    mediaId = verified.mediaId;
    productTagId = verified.productTagId;
    fields = verified.fields;
    if (!(await stillEligible())) {
      await event('skipped', 'stale_trigger');
      return;
    }

    // Always persist the priority assessment (even 'low'/'normal') so
    // the conversation list shows a complete, honest signal rather than
    // only ever surfacing flagged rows. Best-effort; never blocks the
    // reply. Notify only on a genuine transition INTO urgent, not on
    // every subsequent urgent-flagged reply in the same thread.
    if (priority) {
      const becameUrgent =
        priority === 'urgent' && conv.ai_priority !== 'urgent';
      try {
        await db
          .from('conversations')
          .update({ ai_priority: priority, ai_priority_reason: priorityReason })
          .eq('id', conversationId);
        if (becameUrgent) {
          notifyUrgentLead(db, {
            accountId,
            conversationId,
            contactId,
            assignedAgentId: conv.assigned_agent_id ?? null,
            reason: priorityReason,
          }).catch((err) =>
            console.error('[ai auto-reply] urgent notification failed:', err)
          );
        }
      } catch (err) {
        console.error('[ai auto-reply] priority update failed:', err);
      }
    }

    // Deterministic backstop against quoting a price for a product the
    // model never actually committed to (see the price/TAG_PRODUCT
    // coupling rule in defaults.ts) -- a hedged "if you mean X, it's Y"
    // answer is still a price, and the prompt alone can't guarantee the
    // model won't reach for one anyway. If the reply states a
    // price-shaped figure without tagging a product that has a
    // configured range to back it up, treat it exactly like the
    // no-match case: hand off instead of sending an unverified number.
    const quotesUnverifiedPrice =
      !!text &&
      containsPriceFigure(text) &&
      !(
        productTagId &&
        media.some(
          (m) =>
            m.id === productTagId && m.priceMin != null && m.priceMax != null
        )
      );
    if (quotesUnverifiedPrice) {
      console.warn(
        '[ai auto-reply] reply quoted a price without a matching tagged product -- forcing handoff instead of sending it.'
      );
    }

    // Repeated requests are handled by evidence-aware response verification/recovery,
    // not a counter that converts a necessary clarification into a sticky transfer.
    if (
      config.behaviorV2Enabled &&
      !handoff &&
      (!text || quotesUnverifiedPrice)
    ) {
      const reason = quotesUnverifiedPrice ? 'unverified_price' : 'empty_reply';
      await ensureFollowup(db, {
        accountId,
        conversationId,
        sourceMessageId: triggerMessageId,
        kind: 'handoff',
        ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
      });
      await event('failed', reason);
      await notifyReplyReview(db, {
        accountId,
        conversationId,
        contactId,
        ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
        reason,
      });
      return;
    }
    if (handoff || !text || quotesUnverifiedPrice) {
      await performHandoff({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        messages,
        replyCount: conv.ai_reply_count ?? 0,
        handoffAgentId: config.handoffAgentId,
        currentAssignedAgentId: conv.assigned_agent_id,
        triggerMessageId,
        followupKind: salesInput.followupKind,
        routingDecision: quotesUnverifiedPrice
          ? {
              reason: 'unverified_price',
              failures: ['price_evidence'],
              attempt: verified.routingDecision?.attempt ?? 0,
            }
          : (verified.routingDecision ?? {
              reason: handoff ? 'model_requested' : 'empty_reply',
              failures: [],
              attempt: 0,
            }),
        fields,
        ...(jevMode() === 'enforce' ? { expectedDeal: currentDeal } : {}),
      });
      return;
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
      }
    );
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue -- e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr);
      await event('failed', 'slot_unavailable');
      return;
    }
    if (claimed !== true) {
      await event('skipped', 'reply_cap');
      return;
    } // lost the per-conversation cap race

    for (const kind of salesInput.followupKinds ??
      (salesInput.followupKind ? [salesInput.followupKind] : [])) {
      if (config.behaviorV2Enabled && ['location', 'comparison'].includes(kind))
        continue;
      await ensureFollowup(db, {
        accountId,
        conversationId,
        sourceMessageId: triggerMessageId,
        kind,
        ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
      });
    }
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    });

    stageTimes.customerReply = Date.now() - startedAt;
    await event('sent', 'sent');
    if (config.behaviorV2Enabled && verified.knowledgeGap)
      await recordKnowledgeGap(db, {
        accountId,
        createdBy: configOwnerUserId,
        productId: verified.knowledgeGap.productId,
        kind: verified.knowledgeGap.kind,
      });

    // Best-effort media attach: the text reply already landed, so a
    // failure here must not surface as a dispatch failure -- it's logged
    // and swallowed. Never sends anything the model didn't explicitly
    // choose by a real, existing file id (getProductMediaItem returns
    // null for a deleted-mid-conversation or hallucinated id).
    const selectedMedia = [
      ...new Set([...(verified.mediaIds ?? []), ...(mediaId ? [mediaId] : [])]),
    ].slice(0, 2);
    if (config.behaviorV2Enabled && triggerMessageId) {
      for (const fileId of selectedMedia) {
        if (!(await stillEligible())) {
          await event('skipped', 'media_conversation_changed');
          break;
        }
        const outcome = await sendTrackedMedia(db, {
          accountId,
          conversationId,
          contactId,
          userId: configOwnerUserId,
          triggerMessageId,
          fileId,
        });
        if (outcome === 'failed' || outcome === 'uncertain') {
          await event(
            'failed',
            outcome === 'uncertain'
              ? 'media_delivery_uncertain'
              : 'media_send_failed'
          );
          await ensureFollowup(db, {
            accountId,
            conversationId,
            sourceMessageId: triggerMessageId,
            kind: 'document_review',
            ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
          });
          await notifyReplyReview(db, {
            accountId,
            conversationId,
            contactId,
            ownerId: conv.assigned_agent_id ?? config.handoffAgentId,
            kind: 'media',
            reason:
              outcome === 'uncertain'
                ? 'media_delivery_uncertain'
                : 'media_send_failed',
          });
        }
      }
    }
    if (mediaId && !config.behaviorV2Enabled) {
      try {
        const item = await getProductMediaItem(db, accountId, mediaId);
        if (item) {
          const {
            data: { publicUrl },
          } = db.storage.from('ai-media').getPublicUrl(item.storagePath);
          await engineSendMedia({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            kind: item.mediaKind,
            link: publicUrl,
            filename:
              item.mediaKind === 'document'
                ? item.label || item.productName
                : undefined,
          });
        } else {
          console.warn(
            `[ai auto-reply] model chose file id "${mediaId}" but it no longer exists for account ${accountId}.`
          );
        }
      } catch (err) {
        console.error('[ai auto-reply] media send failed:', err);
      }
    }

    // Best-effort product tag: independent of attaching a file -- the
    // model flags a product as clearly the topic of conversation by its
    // product id, and (if that item has a linked tag) we apply it
    // to the contact. Never blocks or fails the reply/attach above.
    if (productTagId) {
      try {
        const taggedProduct = media.find((m) => m.id === productTagId);
        if (taggedProduct?.tagId) {
          await addContactTagAndDispatch({
            db,
            accountId,
            contactId,
            tagId: taggedProduct.tagId,
            aiGenerated: true,
          });
        } else {
          console.warn(
            `[ai auto-reply] model flagged product id "${productTagId}" but it has no linked tag or no longer exists for account ${accountId}.`
          );
        }
      } catch (err) {
        console.error('[ai auto-reply] product tag failed:', err);
      }
    }

    // Best-effort lead-detail capture: independent of media/tag --
    // whenever the model recorded lead details this turn, save them
    // onto the contact and mirror a summary onto the linked deal.
    if (fields && fields.length > 0) {
      try {
        await applyCollectedFields({
          db,
          accountId,
          contactId,
          fields,
          ...(jevMode() === 'enforce' ? { expectedDeal: currentDeal } : {}),
        });
      } catch (err) {
        console.error('[ai auto-reply] field collection failed:', err);
      }
    }
    await refreshStaffSummary();
  } catch (err) {
    await event(
      'failed',
      config?.behaviorV2Enabled ? 'provider_unavailable' : 'generation_failed'
    );
    if (config?.behaviorV2Enabled)
      await notifyReplyReview(db, {
        accountId,
        conversationId,
        contactId,
        ownerId: config.handoffAgentId,
        reason: 'provider_unavailable',
      });
    await ensureFollowup(db, {
      accountId,
      conversationId,
      sourceMessageId: triggerMessageId,
      kind: 'handoff',
      ownerId: null,
    });
    if (err instanceof AiError && err.code === 'invalid_key') {
      const isFreshFailure = !config?.lastKeyError;
      try {
        await recordKeyError(db, accountId, err.message);
        if (isFreshFailure) {
          await notifyAdminsOfKeyError(db, accountId, err.message);
        }
      } catch (recordErr) {
        console.error('[ai auto-reply] failed to record key error:', recordErr);
      }
    }
    console.error('[ai auto-reply] dispatch failed:', err);
  }
}
