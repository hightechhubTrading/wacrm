# Per-agent WAHA conversation channels

**Date:** 2026-07-29
**Status:** Approved — ready for implementation planning

## Problem

Every conversation in this CRM goes through one shared WhatsApp number (Meta
Cloud API, `whatsapp_config`, one row per account). Some clients want to be
able to *call* the person they're talking to, not just text — and Meta's
Cloud API has no calling capability at all. The only way to give a client a
callable number is to hand them a real WhatsApp account on a real device,
which means giving them the assigned agent's own number.

WAHA (a self-hosted, unofficial WhatsApp HTTP API client) already exists in
this codebase for one narrow purpose today: posting a fire-and-forget text
into an internal notification group when a deal moves pipeline stage
(`src/lib/notifications/waha-client.ts`, `src/app/api/waha/config/route.ts`).
It has never been used for a real, bidirectional customer conversation.

Crucially, **per-agent WAHA sessions already exist too** — migration 045
added `profiles.waha_session_name` (admin-editable in Settings → Members
today) specifically so a deal's stage-enter group notification could be
sent from the *assigned agent's own* WAHA session instead of one shared
default (`src/lib/pipelines/notify.ts`). And migration 052 added
`profiles.phone` — "the agent's own WhatsApp/call number, offered to a
customer who asks to talk by phone" — currently only used by the AI to
*mention* verbally. This spec is what connects those two existing pieces to
actual conversation routing, rather than inventing new per-agent storage.

This spec covers routing a conversation's messages through an assigned
agent's own WAHA-connected WhatsApp number when one exists, so clients who
prefer to call can call that agent directly — while keeping every message
(regardless of channel) inside the same unified conversation thread the CRM
already shows.

## Non-goals

- **No automation on WAHA-routed conversations.** No AI auto-reply, no
  Flows, no bot logic of any kind. Numbers used this way are agents' real,
  already-warmed personal-style WhatsApp accounts — automated traffic on them
  is exactly the pattern that gets numbers banned, and the customer
  explicitly wants manual, human-only conversation here.
- **No call logging / call visibility inside the CRM.** The client calling
  the agent's real number is a capability that exists simply because it's a
  real WhatsApp account — it needs no CRM support. WAHA's call-webhook
  support is inconsistent across engines and isn't worth building against
  for v1.
- **No in-app QR pairing UI.** Session pairing continues to happen the same
  way it does today for the group-notification WAHA config: the admin pairs
  the session directly against the WAHA server/dashboard, then registers the
  already-authenticated session in the CRM.
- **No retroactive conversation handoff.** Reassigning a conversation to a
  different agent does not move the client to that agent's number — WhatsApp
  has no concept of forwarding an in-progress thread between two numbers.
  This is a process/human limitation, not something software fixes.
- **No changes to `waha_config` (group notifications)** or to any
  tag-triggered automation (`contacts/tag-events.ts`). Both are pre-existing,
  unrelated features.

## Data model

No new table. Everything needed already exists except one column:

- **`waha_config`** (account-level, unchanged) — the one shared WAHA
  server: `base_url`, `api_key`. Already there.
- **`profiles.waha_session_name`** (already exists, migration 045) — which
  WAHA session this agent's replies go out from. Already admin-editable in
  Settings → Members.
- **`profiles.phone`** (already exists, migration 052) — the agent's own
  number. Already admin/self-editable. Reused as-is: whatever number the AI
  is already allowed to mention verbally is the same number WAHA connects
  to. A conversation only routes through WAHA when *both* `waha_session_name`
  and `phone` are set for the assigned agent — either alone isn't enough
  (a session with no known number can't be matched against inbound senders
  or shown to the admin; a phone number with no session can't send).
- **`profiles.waha_webhook_secret`** (new column) — encrypted, same scheme
  as `waha_config.api_key`. Authenticates inbound webhook calls for this
  agent's session (see Inbound routing below). Generated server-side the
  first time an admin sets a `waha_session_name`; cleared whenever the
  session is cleared, so a disconnected agent's old webhook URL stops
  working immediately.

`messages` gets one new column: `channel TEXT NOT NULL DEFAULT 'meta' CHECK
(channel IN ('meta', 'waha'))`, recording which line a given message actually
went out/came in on.

## Registration flow (admin only)

- Extends the existing Settings → Members row UI (`members-tab.tsx`), which
  already has an inline `waha_session_name` input — adds a phone-number
  input next to it (writing to the existing `profiles.phone`) and a
  "Get webhook URL" action once both are set.
- The admin still pairs the session externally on the WAHA server first (QR
  scan on the agent's phone), exactly like today's group-notification setup
  and today's per-agent session for stage-enter notifications — nothing new
  here.
- "Get webhook URL" reveals the full URL (including the secret) once, for
  the admin to paste into that WAHA session's webhook configuration on the
  server side.
- The existing `PATCH /api/account/members/[userId]` route (today handles
  `role` and `waha_session_name`) is extended to also accept `phone`, and to
  generate/return the webhook secret the first time a session is connected.
  Same admin+ auth, same underlying SECURITY DEFINER RPC pattern as
  `set_member_waha_session` (migration 045) — extended to also set `phone`
  and (re)generate `waha_webhook_secret` in one call.

## Outbound routing

`sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`) gains a
channel-resolution step before it builds the send:

1. Load `conversations.assigned_agent_id`.
2. If set, look up that agent's `profiles` row for `waha_session_name` and
   `phone`. Both must be non-null.
3. If found → send via WAHA (using `waha_config.base_url`/`api_key` plus the
   agent's own `session_name`). Otherwise → today's Meta path, unchanged.

The WAHA path is narrower than the Meta path by necessity — templates and
interactive buttons/lists are Business-API-only features and simply don't
exist on a personal WhatsApp account. Only `text` and plain media
(image/video/document/audio) are supported. No phone-number-variant retry
(that's a Meta-recipient-allowlist quirk that doesn't apply to a real 1:1
chat) and no reply-context threading in v1.

`waha-client.ts` gets a sibling to `sendWahaGroupText` for individual chats:
same request shape (`POST /api/sendText`, `X-Api-Key`), `chatId` built as
`<e164-digits>@c.us` instead of `...@g.us`, using the agent's own
`session_name`. Unlike `sendWahaGroupText` (deliberately fire-and-forget,
never throws — acceptable for a best-effort internal notification), this new
function **must** surface failures: it's the primary customer channel for
this conversation. A disconnected session throws a `SendMessageError` with a
clear message ("this agent's WhatsApp number is disconnected — reconnect the
session or reassign the conversation"), same pattern as Meta failures today.

The persisted message row gets `channel: 'waha'`, and the composer
(`message-thread.tsx`) hides the template/interactive pickers whenever the
conversation's resolved channel is WAHA — not disabled-with-explanation,
just not offered, since they're structurally inapplicable.

## Inbound routing

New route: `POST /api/waha/webhook/[accountId]/[sessionName]?secret=...`. The
`secret` is `profiles.waha_webhook_secret`, generated when the admin
connects the session (shown once in the admin panel, alongside the full
webhook URL to paste into that WAHA session's webhook configuration on the
server side) — without it, `accountId`/`sessionName` alone would be
guessable/enumerable, letting anyone POST forged inbound messages.

Handler:

1. Resolve the `profiles` row for `(account_id = accountId, waha_session_name
   = sessionName)`; 404/ignore if not found or the `secret` doesn't match
   the (decrypted) `waha_webhook_secret`.
2. Extract the sender's phone number and message content (text or basic
   media) from the WAHA event payload.
3. Reuse the **same** `findOrCreateContact` / `findOrCreateConversation`
   helpers the Meta webhook already uses (extracted out of
   `whatsapp/webhook/route.ts` so both webhooks share one code path) — this
   is what keeps a contact's WAHA and Meta messages in one unified thread
   instead of forking a second conversation per channel.
4. Insert the message (`sender_type: 'customer'`, `channel: 'waha'`), update
   `conversations.last_message_text/at` and `unread_count`, same as the Meta
   path.
5. Only text and basic media events are handled. Read receipts, reactions,
   and status events are Meta-only and out of scope here — the WAHA webhook
   simply doesn't listen for them.

Crucially, this handler **never imports or calls**
`runAutomationsForTrigger`, `dispatchInboundToFlows`, or
`dispatchInboundToAiReply`. Those are only ever invoked from the Meta
webhook today (confirmed by inspection — there's no shared DB trigger or
generic "on new message" hook). Because the WAHA webhook is a separate route
that never calls them, WAHA-routed conversations get zero bot involvement by
construction, not by a conditional flag that could be gotten wrong.

## UI summary

- Settings → Members: per-agent WAHA channel registration (new).
- Assignment dropdown (existing, `message-thread.tsx`): unchanged in
  behavior, gets a small indicator next to agents who have a connected
  number so whoever assigns knows what will happen.
- Thread header/composer: a lightweight badge when the active channel is
  WAHA (e.g. "via Sarah's WhatsApp"), and template/interactive controls
  hidden in that state.

## Testing

- Unit: new individual-chat WAHA send function (mirrors
  `waha-client.test.ts` style).
- Unit: channel-resolution helper — assigned agent with/without an active
  channel resolves to the right branch.
- Integration: WAHA webhook — inbound message lands in the same conversation
  as existing Meta history for that contact; asserts the automation
  functions are never invoked.
- Manual: pair a real WAHA session, assign a test conversation, send/receive
  a message end to end, confirm no AI/Flow triggers fire, confirm
  template/interactive controls are hidden in the composer.
