# Debounce AI auto-reply across a burst of customer messages

Date: 2026-08-03

## Problem

Today, `dispatchInboundToAiReply` is called once per inbound customer
message, immediately, from inside `processMessage`
(`src/app/api/whatsapp/webhook/route.ts`). When a customer sends
several messages in quick succession — a common WhatsApp habit, one
thought split across 2-4 short messages instead of one longer one —
the bot replies to each individually. This reads as the bot not
following the conversation (each reply only "sees" one fragment) and,
worse, sometimes produces two separate AI-generated replies back to
back for what was really one customer turn.

The business already tried to work around this with a prompt
instruction ("wait a little in case the customer sends more than one
message, then reply once") in their `system_prompt`. That cannot work:
`generateReply` only runs when invoked, once per webhook call — an LLM
has no mechanism to defer its own invocation. Fixing this requires an
actual wait in the dispatch code, not a smarter prompt.

## Goals

- A burst of customer messages sent within ~8 seconds of each other
  produces exactly one AI reply, addressing the whole burst (not the
  first or an arbitrary one — `dispatchInboundToAiReply` already
  builds its context from the full recent conversation history, so
  whichever message in the burst actually triggers the call sees
  everything).
- A single, isolated customer message still gets a reply — just ~8s
  later than today, not suppressed.
- The behavior is an explicit account-level toggle in `ai_configs`,
  off by default, matching every other AI behavior in this app
  (`auto_reply_enabled`, `after_hours_takeover_enabled`, etc.).
- A burst that arrives as multiple messages in a *single* Meta webhook
  payload (WhatsApp does batch near-simultaneous messages this way)
  is debounced exactly the same as a burst arriving as separate
  webhook calls — no double reply, no serialized multi-times-8-second
  delay blocking the rest of that payload's processing.
- Existing flow/automation precedence is unchanged: if a later message
  in the burst gets consumed by the flow runner, the earlier message's
  deferred AI reply is silently superseded (no reply fires for that
  burst) — same "flows win over the LLM" rule the code already
  enforces per-message, just applied burst-wide.

## Non-goals

- WAHA-routed conversations. `src/app/api/waha/webhook/[accountId]/
  [sessionName]/route.ts` has zero bot involvement by construction
  (see its file-header comment) — this spec doesn't touch it.
- A configurable wait duration. 8 seconds is a constant
  (`AI_REPLY_DEBOUNCE_MS`), not a per-account setting — the user asked
  for an on/off switch, not a tuning knob. Can become configurable
  later if a real need shows up.
- Debouncing automations or the flow runner. Both already run
  synchronously, per-message, unaffected by this change. The
  complaint (and the "flows win" precedent above) is specifically
  about the LLM auto-reply path.
- Persisting in-flight debounce state across a process restart. This
  is a best-effort UX feature, same tier as the flow runner and
  automations dispatch (already wrapped in try/catch, already
  documented as best-effort elsewhere in this file) — if the
  container restarts mid-wait, the worst case is one missed reply for
  one burst, not a correctness or data-loss issue.

## Architecture

### Config: `ai_configs.ai_reply_debounce_enabled`

New migration `supabase/migrations/058_ai_reply_debounce.sql`
(058 is the next free number as of this spec's writing — verify with
`ls supabase/migrations | sort -t_ -k1 -n | tail -5` at implementation
time in case more have landed since). Adds a `NOT NULL DEFAULT false`
column, following the exact shape of `after_hours_takeover_enabled`
(migration 051, `ADD COLUMN IF NOT EXISTS after_hours_takeover_enabled
BOOLEAN NOT NULL DEFAULT false`) and `transcribe_voice_messages`
(migration 049):

```sql
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_reply_debounce_enabled BOOLEAN NOT NULL DEFAULT false;
```

`src/lib/ai/config.ts`: add `ai_reply_debounce_enabled` to the
`AiConfigRow` select-string/interface and the `loadAiConfig` mapping,
same pattern as every other boolean flag in that file.

`src/lib/ai/types.ts`: add `aiReplyDebounceEnabled: boolean` to
`AiConfig`, alongside `afterHoursTakeoverEnabled`.

### Settings UI

`src/components/settings/ai-config.tsx`: one new toggle, placed near
the existing `auto_reply_enabled` / `after_hours_takeover_enabled`
switches, same `Switch` + label + description component pattern
already used there. Label: "Wait for multiple messages before
replying". Description: "Collects messages the customer sends within
a few seconds of each other into one reply, instead of replying to
each individually."

### Dispatch: `src/app/api/whatsapp/webhook/route.ts`

**Threading a pending-dispatch list through the call chain.**
`processWebhook(body)` currently drives three nested loops (`entry` →
`change` → `message`), calling `await processMessage(...)` once per
message, fully sequentially. A naive `await sleep(8000)` inside
`processMessage`'s AI block would serialize: three messages in one
webhook payload would take 24+ seconds to finish processing, delaying
that payload's flows/automations/contact-creation for messages 2 and
3 behind message 1's wait. Instead, `processWebhook` collects each
scheduled AI dispatch into an array and awaits them all together,
concurrently, after the per-message loop finishes:

```ts
async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return
  const pendingAiDispatches: Promise<void>[] = []

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // ...unchanged template/status handling...

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          config.account_id,
          config.user_id,
          decryptedAccessToken,
          pendingAiDispatches, // NEW — mutated in place
        )
      }
    }
  }

  // Let every debounced AI reply this payload scheduled actually run
  // to completion before the after() block (which awaits
  // processWebhook in full) is allowed to resolve — same reasoning as
  // the existing after() comment: a promise this function can't see
  // (a truly detached setTimeout/then) risks being frozen mid-flight.
  await Promise.allSettled(pendingAiDispatches)
}
```

**`processMessage`'s new parameter** — added to its existing
signature, threaded straight through to the one call site that needs
it:

```ts
async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  accountId: string,
  configOwnerUserId: string,
  accessToken: string,
  pendingAiDispatches: Promise<void>[], // NEW
) {
  // ...unchanged through automations dispatch...

  if (!isControlMessage && !flowConsumed && !interactiveReplyId && inboundText.trim()) {
    const aiConfig = await loadAiConfig(supabaseAdmin(), accountId, { requireActive: false })
    if (aiConfig?.aiReplyDebounceEnabled) {
      pendingAiDispatches.push(
        debouncedDispatchInboundToAiReply({
          accountId,
          conversationId: conversation.id,
          contactId: contactRecord.id,
          configOwnerUserId,
          messageId: message.id,
        }),
      )
    } else {
      await dispatchInboundToAiReply({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
      })
    }
  }

  // ...unchanged message.received webhook dispatch...
}
```

Loading `aiConfig` here duplicates a lookup `dispatchInboundToAiReply`
also does internally (via `loadAiConfig` in `auto-reply.ts`) — accepted
duplication, not worth threading the already-loaded config through
just to save one indexed SELECT; matches this file's existing style of
each concern fetching what it needs.

### `debouncedDispatchInboundToAiReply` — new function in `src/lib/ai/auto-reply.ts`

`AI_REPLY_DEBOUNCE_MS` is defined in this file (not the webhook route)
since this is the only function that uses it:

```ts
const AI_REPLY_DEBOUNCE_MS = 8_000

/**
 * Wraps dispatchInboundToAiReply with an `AI_REPLY_DEBOUNCE_MS` wait:
 * after the wait, re-checks whether `messageId` is still the most
 * recent customer message in the conversation. If a newer one arrived
 * during the wait, skips — that newer message scheduled its own
 * debounced dispatch, which will run instead. This is what turns a
 * burst of N customer messages into exactly one AI reply: only the
 * dispatch scheduled by the LAST message in the burst finds itself
 * still "latest" when its wait elapses.
 *
 * Never throws — same contract as dispatchInboundToAiReply, which
 * this delegates to once the latest-check passes.
 */
export async function debouncedDispatchInboundToAiReply(args: {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  messageId: string
}): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, AI_REPLY_DEBOUNCE_MS))

  const db = supabaseAdmin()
  const { data: latest, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[ai auto-reply] debounce latest-check failed, replying anyway:', error)
  } else if (latest && latest.id !== args.messageId) {
    // Superseded — a later message's own debounced dispatch will
    // (or already did) handle this conversation's reply.
    return
  }

  await dispatchInboundToAiReply({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    configOwnerUserId: args.configOwnerUserId,
  })
}
```

**On the error-swallowing choice above:** a failed latest-check
degrades to "reply anyway" (not "skip anyway") — matching this
codebase's general bias in `auto-reply.ts` (every media/tag/lead-detail
side effect there is best-effort and fails toward "still send the
core reply"). A false "still latest" occasionally sending one extra
reply is a much smaller problem than a DB hiccup silently swallowing
a customer's only reply.

### Composition with flows/automations (worked example)

Customer sends "hi" (N) then, 2s later, "3x2 meters" (N+1) in the same
burst:

- N arrives: not flow-consumed, not control, eligible → schedules a
  debounced dispatch for N (fires at N+8s).
- N+1 arrives 2s later: say it happens to match a flow keyword trigger
  → `flowConsumed = true` for N+1 → N+1 does NOT schedule its own
  dispatch (same as today's per-message gate, unchanged).
- At N+8s, N's debounced dispatch wakes up, checks "am I still the
  latest customer message?" → no, N+1 is newer → skips. Net result:
  zero AI replies, one flow reply — matches "flows win," now applied
  correctly across the whole burst instead of leaving N's reply to
  fire independently the way it would under today's code (which would
  have replied to N immediately, before N+1 even arrived, producing
  both an AI reply AND a flow reply back to back — the exact
  double-speaking complaint this spec exists to fix).

### Tests

- `src/lib/ai/auto-reply.test.ts`: new tests for
  `debouncedDispatchInboundToAiReply` — use `vi.useFakeTimers()` to
  avoid a real 8-second wait. Cases: (1) still latest after the wait →
  delegates to `dispatchInboundToAiReply` with the same args; (2) a
  newer customer message exists at wait-end → does not call
  `dispatchInboundToAiReply`; (3) the latest-check query errors →
  still delegates (fail toward replying).
- `src/app/api/whatsapp/webhook/route.ts` has no existing test file
  (verified: only `src/app/api/whatsapp/send/route.test.ts` exists in
  that directory, a different route) — writing one from scratch is a
  separate, larger undertaking (mocking the full Meta payload shape,
  `supabaseAdmin()`, flows/automations dispatch, etc.) than this
  feature needs. The `debouncedDispatchInboundToAiReply` unit tests
  above already cover the actual debounce/latest-check logic in
  isolation; the webhook route's job is just correctly threading
  `pendingAiDispatches` through, which is small enough to verify by
  reading the diff plus a manual smoke test (send 2-3 quick WhatsApp
  messages to a debounce-enabled test account, confirm one reply).

## Rollout

Single migration + code change, no feature flag beyond the
`ai_reply_debounce_enabled` toggle itself (which starts `false` for
every account, including this account — the business needs to
explicitly turn it on in Settings after this ships, it does not
retroactively change behavior for anyone).
