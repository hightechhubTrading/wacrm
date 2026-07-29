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
this codebase, but only for one narrow, isolated purpose: posting a
fire-and-forget text into an internal notification group when a deal moves
pipeline stage (`src/lib/notifications/waha-client.ts`,
`src/app/api/waha/config/route.ts`). It has never been used for a real,
bidirectional customer conversation.

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

New table, independent of `waha_config`:

```sql
CREATE TABLE agent_waha_channels (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_url      TEXT NOT NULL,
  api_key       TEXT NOT NULL,       -- encrypted, same scheme as whatsapp_config/waha_config
  session_name  TEXT NOT NULL,       -- WAHA session, already paired externally
  phone_number  TEXT NOT NULL,       -- E.164, filled in by the admin after pairing
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, session_name),
  UNIQUE (account_id, user_id)   -- one active number per agent
);
```

Kept fully separate from `waha_config` rather than extended into it: the
existing table's code explicitly calls out its isolation for one narrow
purpose (group notifications, fire-and-forget, never throws), and cramming a
second, bidirectional, per-agent use case into the same table would mean
both features branching around each other's assumptions in shared code. The
duplication of `base_url`/`api_key` per row is an acceptable cost for keeping
each feature simple and independently changeable.

`messages` gets one new column: `channel TEXT NOT NULL DEFAULT 'meta' CHECK
(channel IN ('meta', 'waha'))`, recording which line a given message actually
went out/came in on.

## Registration flow (admin only)

- New panel on a member's row/detail in Settings → Members (not the general
  WAHA settings panel — this is per-agent, matching "the number they have in
  their profile").
- Same fields and pattern as today's group-notification WAHA config
  (`waha-config.tsx`): base_url, session_name, api_key, plus which agent it
  belongs to and their phone number.
- Admin pairs the session externally on the WAHA server first (QR scan on
  the agent's phone, exactly like today), then registers the session here.
- New routes `GET/POST/DELETE /api/waha/agent-channels`, mirroring
  `/api/waha/config`'s auth (`requireRole('admin')`) and encryption
  (`encrypt`/`decrypt`) patterns.
- Registration is rejected if the phone number is already bound to another
  `agent_waha_channels` row or to the account's `whatsapp_config` number, to
  avoid two channels resolving to the same number.

## Outbound routing

`sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`) gains a
channel-resolution step before it builds the send:

1. Load `conversations.assigned_agent_id`.
2. If set, look up an active `agent_waha_channels` row for
   `(account_id, assigned_agent_id)`.
3. If found → send via WAHA. Otherwise → today's Meta path, unchanged.

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

New route: `POST /api/waha/webhook/[accountId]/[sessionName]`. The admin
points each agent's WAHA session's webhook configuration at this URL
(external, on the WAHA server side — same as any WAHA session setup).

Handler:

1. Resolve the `agent_waha_channels` row from `(accountId, sessionName)`;
   404/ignore if not found or inactive.
2. Extract the sender's phone number and message content (text or basic
   media) from the WAHA event payload.
3. Reuse the **same** `findOrCreateContact` / `findOrCreateConversation`
   helpers the Meta webhook already uses (extracted out of
   `whatsapp/webhook/route.ts` so both webhooks share one code path) — this
   is what keeps a contact's WAHA and Meta messages in one unified thread
   instead of forking a second conversation per channel.
4. Insert the message (`sender_type: 'contact'`, `channel: 'waha'`), update
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
