# CTWA Lead Quality → Meta Conversions API — Design

**Date:** 2026-09-28
**Owner:** Nader
**Status:** Draft — awaiting review

## Goal

HTH runs Click-to-WhatsApp (CTWA) ads. Meta only learns that a chat
started, so it optimizes for cheap chats instead of good customers. This
feature:

1. Captures the ad click ID (`ctwa_clid`) and ad ID when a conversation
   starts from an ad.
2. Lets staff tag conversations as they progress (Qualified → Site visit /
   Quote sent → Won).
3. Sends each tag to Meta as a Conversions API for Business Messaging event
   tied to that click ID.
4. Reports qualified leads and won value per ad inside the app (CSV export).

Out of scope (v1): Messenger/Instagram attribution, changing ad campaigns,
backfilling old conversations.

## Findings that shape the design

- Inbound customer messages arrive via the official Cloud API webhook,
  `src/app/api/whatsapp/webhook/route.ts`. The full JSON is parsed but the
  `WhatsAppMessage` type has no `referral` field, so the click ID is
  currently dropped. WAHA sessions (agent numbers, group notifications)
  never carry a referral; their conversations tag as `skipped_no_clid`.
- The app runs as a single long-lived Next.js container (Docker on
  Hostinger), not serverless. There is no job queue.
- Every new conversation gets an auto-created lead deal (migration 041).
  Deals already have `status IN ('open','won','lost')`, `value`, and
  `currency`. One conversation per contact since migration 036.
- Deals can be marked won directly from the browser
  (`deal-form.tsx` → `supabase.from('deals').update({ status })`), and via
  the public API — so Won must be detected in the database, not in one
  route.
- Roles: owner / admin / agent / viewer.

## Decisions

| Topic | Decision |
|---|---|
| Won vs. deals | **Won in the inbox marks the linked deal won.** A deal becoming won (from any path) is what enqueues the Purchase event. Single source of truth for revenue. |
| Who can tag | **Agent and above** for all stages, matching today's pipeline permissions (agents limited to their assigned deals by existing RLS). Viewers cannot tag. |
| Report / failed-sends page | Admin and above. |
| Delivery worker | In-process poller started from `instrumentation.ts`, not an external cron. |
| WABA ID | `META_WABA_ID` env var (per original spec). |
| Won value | Required and > 0, in both the inbox Won dialog and the pipeline "Mark won" action. |

## Architecture

### 1. Capture (webhook)

- Add to `WhatsAppMessage`:
  `referral?: { source_type?: string; source_id?: string; source_url?: string; headline?: string; body?: string; ctwa_clid?: string; [k: string]: unknown }`.
- In `processMessage()`, after the conversation is resolved and after the
  duplicate-message guard, call `recordCtwaAttribution(...)` from a new
  module `src/lib/conversions/attribution.ts` when
  `referral.source_type === 'ad'` and `referral.ctwa_clid` is non-empty.
- Insert is idempotent: unique `(conversation_id, message_id)` with
  `ON CONFLICT DO NOTHING`. A later ad click by the same contact inserts a
  new row; events always use the most recent `clicked_at`.
- `clicked_at` = message `timestamp`. `raw_referral` stores the full object.
- Never log `ctwa_clid`. Log lines reference the attribution row ID only.
- Failure to record never blocks message processing (try/catch, log).

### 2. Data model — migration `065_ctwa_conversions.sql`

**`ctwa_attributions`**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid fk accounts, not null | tenancy / RLS |
| conversation_id | uuid fk conversations, cascade | |
| contact_wa_id | text not null | `messages[].from` |
| message_id | text not null | wamid; idempotency |
| ctwa_clid | text not null | server-only |
| ad_id | text | `referral.source_id` |
| headline | text | |
| source_url | text | |
| raw_referral | jsonb not null | |
| clicked_at | timestamptz not null | |
| created_at | timestamptz default now() | |

Unique `(conversation_id, message_id)`; index `(conversation_id, clicked_at desc)`.

**`conversion_events`** (outbox)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid fk accounts, not null | |
| conversation_id | uuid fk conversations, cascade | |
| attribution_id | uuid fk ctwa_attributions, null | null when skipped |
| deal_id | uuid fk deals, set null | Won only |
| stage | text check in (`qualified`,`site_visit`,`won`) | |
| meta_event_name | text not null | `QualifiedLead` / `LeadSubmitted` / `Purchase` |
| event_id | text unique not null | `{conversation_id}:{stage}` |
| value | numeric(12,2) | Won only |
| currency | text | `QAR` for Won |
| status | text check in (`pending`,`sending`,`sent`,`failed`,`skipped_no_clid`) | |
| attempts | int default 0 | |
| next_attempt_at | timestamptz default now() | |
| last_error | text | |
| meta_response | jsonb | `events_received`, `fbtrace_id` |
| tagged_by | uuid fk auth.users | |
| tagged_at | timestamptz not null | used as `event_time` |
| sent_at | timestamptz | |
| undone_at | timestamptz | UI-only undo |
| created_at | timestamptz default now() | |

Index `(status, next_attempt_at)` for the poller.

**RLS**
- `ctwa_attributions`: no direct client access. The UI reads ad
  info through a view `conversation_ad_sources` (conversation_id,
  account_id, ad_id, headline, clicked_at — **no clid**) scoped by
  account membership.
- `conversion_events`: SELECT for account members; no client
  INSERT/UPDATE/DELETE. All writes go through the SQL function below or
  server routes using the service role.

### 3. Enqueueing

SQL function `enqueue_conversion(p_conversation_id, p_stage, p_value, p_currency, p_deal_id, p_user_id)`,
`SECURITY DEFINER`:

1. Look up the latest `ctwa_attributions` row for the conversation.
2. Insert a `conversion_events` row with
   `event_id = conversation_id || ':' || stage`,
   `status = 'pending'` if an attribution exists, else `'skipped_no_clid'`,
   `tagged_at = now()`, event name from the stage mapping.
3. `ON CONFLICT (event_id) DO UPDATE SET undone_at = NULL` — re-tagging
   after an undo restores the tag in the UI but never re-sends.
4. For `won`: first enqueue `qualified` the same way (no-op if present).

**Callers**
- **Qualified / Site visit:** `POST /api/conversions`
  `{ conversation_id, stage }` → `requireRole('agent')`, verify the caller
  can see the conversation (RLS-scoped read), call `enqueue_conversion`.
  Then `after()` kicks the sender for immediate delivery.
- **Won:** trigger `deals_enqueue_won` `AFTER UPDATE OF status` (and
  `AFTER INSERT`) on `deals`, firing when `NEW.status = 'won'` and
  `OLD.status IS DISTINCT FROM 'won'`. Conversation =
  `NEW.conversation_id`, falling back to the contact's conversation.
  Value = `NEW.value`, currency = `NEW.currency`. `tagged_by` =
  `auth.uid()` (null for service-role paths).
- **Inbox Won button:** `POST /api/conversions`
  `{ conversation_id, stage: 'won', value }` → finds the conversation's
  most recent open deal (creates one in the first pipeline's first stage if
  none), updates `value`, `currency = 'QAR'`, `status = 'won'` using the
  caller's RLS-scoped client — the trigger enqueues.
- **Undo:** `DELETE /api/conversions/[id]` sets `undone_at = now()`.
  Nothing is retracted from Meta; the UI says so.

### 4. Delivery (outbox sender)

Module `src/lib/conversions/sender.ts`:

- `claimDueEvents(limit)` — one atomic
  `UPDATE conversion_events SET status='sending', attempts = attempts + 1
   WHERE id IN (SELECT id … WHERE status IN ('pending','failed')
   AND next_attempt_at <= now() AND attempts < 5
   ORDER BY next_attempt_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *`
  (as an RPC). `sent` rows are never selected.
- `buildPayload(row, attribution, env)` — pure function:

  ```json
  {
    "data": [{
      "event_name": "<meta_event_name>",
      "event_time": <unix seconds of tagged_at>,
      "event_id": "<event_id>",
      "action_source": "business_messaging",
      "messaging_channel": "whatsapp",
      "user_data": {
        "whatsapp_business_account_id": "<META_WABA_ID>",
        "ctwa_clid": "<ctwa_clid, unhashed>"
      },
      "custom_data": { "currency": "QAR", "value": <value> }
    }],
    "test_event_code": "<META_TEST_EVENT_CODE, only if set>"
  }
  ```
  `custom_data` only for Purchase.
- POST to
  `https://graph.facebook.com/{GRAPH_API_VERSION}/{META_DATASET_ID}/events`
  with `access_token = META_CAPI_ACCESS_TOKEN`.
- 2xx → `status='sent'`, `sent_at`, `meta_response`.
  Non-2xx / network error → `status='failed'`, `last_error` (Meta's
  `error.message` + code), `next_attempt_at` = now + backoff
  `[1m, 5m, 30m, 2h, 12h][attempts-1]`. After attempt 5 the row stays
  `failed` and appears in the admin view.
- Rows stuck in `sending` for > 10 minutes (process crash) are returned to
  `failed` by the claim query.
- If `META_CAPI_ENABLED !== 'true'` or required env vars are missing, the
  sender does nothing; rows stay `pending` and send once enabled.

**Scheduling:** `instrumentation.ts` (Node runtime) starts
`startConversionPoller()` — a `setInterval` every 60 s, guarded against
overlapping runs. Routes also call `runConversionSender()` inside
`after()` for near-immediate delivery.

### 5. Configuration

Added to `.env.local.example`, `.env.production.example`,
`docker-compose.yml`:

| var | notes |
|---|---|
| `META_CAPI_ENABLED` | `true` to send; default off |
| `META_DATASET_ID` | dataset linked to the WABA |
| `META_WABA_ID` | WhatsApp Business Account ID |
| `META_CAPI_ACCESS_TOKEN` | System User token: `whatsapp_business_management` + `whatsapp_business_manage_events` |
| `GRAPH_API_VERSION` | current Graph version, e.g. `v24.0` |
| `META_TEST_EVENT_CODE` | optional |

### 6. UI

- **Contact sidebar** (`src/components/inbox/contact-sidebar.tsx`):
  new `ConversionStages` component — "From ad: <headline or ad ID>"
  badge when an attribution exists; three chips (Qualified, Site visit /
  Quote sent, Won) showing tagged state, each behind a confirm dialog. Won
  dialog requires a QAR value > 0 (prefilled from the open deal's value).
  Undo shows: "This removes the tag here only. Meta has already received
  the event and it will not be retracted." Organic chats show a muted
  "Not from an ad — tracked internally only" line. Hidden for viewers.
- **Conversation list:** small ad icon/badge on conversations with an
  attribution.
- **Pipeline deal form:** "Mark won" requires `value > 0`; otherwise it
  prompts for the value first.
- **New page `/ad-conversions`** (admin+, sidebar entry): date range filter
  (by `clicked_at`), table per ad — Ad ID / headline, Conversations,
  Qualified, Site visit, Won, Won value (QAR), Qualified rate — with CSV
  export. Second section "Failed sends": stage, conversation link, attempts,
  last error, last attempt time. Undone tags are excluded from counts.
- All strings added to `messages/en.json` and `messages/ar.json`.

### 7. Error handling summary

| case | behavior |
|---|---|
| Referral without `ctwa_clid` / non-ad source | nothing stored |
| Attribution insert fails | logged (no clid), message processing continues |
| Tag on organic conversation | row `skipped_no_clid`, no HTTP call |
| Same stage tagged twice | single row; no second send |
| Meta 4xx/5xx or network error | `failed` + retry with backoff, max 5 attempts |
| Feature flag off / env missing | rows stay `pending` |
| Event arrives > 7 days after the click | sent anyway; Meta's response or error is stored (see below) |

### 8. Event age constraint

`event_time` must be within the last 7 days — always satisfied because
`event_time` is the tag time and events send within minutes. The practical
limit is attribution: Meta's click attribution window for CTWA is typically
7 days, so a Won tagged weeks after the click will likely be accepted but
not credited to the ad in Ads Manager. Meta's onboarding guide states no
explicit maximum click-ID age. Approach: always send, store the response,
and treat the in-app `/ad-conversions` report (which joins on our own
attribution records, with no window) as the authoritative per-ad view.
Verify real behavior during the live test.

## Testing

Vitest, test-first:

- `attribution.test.ts`: ad referral → row; no referral / non-ad → none;
  duplicate wamid → one row; second click → second row, latest used.
- `sender.test.ts`: `buildPayload` exact snapshot (field names,
  unhashed clid, QAR + value only on Purchase, `test_event_code` only when
  set); 2xx → `sent` + response stored; 4xx → `failed`, error stored,
  backoff scheduled; 5th failure → no further retry; flag off → no fetch;
  `skipped_no_clid` never fetched.
- `route.test.ts` for `/api/conversions`: viewer → 403; qualified
  enqueues; won with no/zero value → 400; won updates deal.
- SQL behavior (enqueue idempotency, Won creating Qualified + Purchase,
  deal trigger) verified against the Supabase project after migration via
  SQL checks, matching how prior migrations were validated.

Live test: set `META_TEST_EVENT_CODE`, enable the flag, tap a live HTH ad
from a test phone, tag Qualified then Won, confirm both in Events Manager →
Test Events, then remove the test code.

## Meta-side setup (for the PR description — not done in code)

1. Confirm the WhatsApp app has advanced access to
   `whatsapp_business_manage_events`.
2. Create a System User, assign the WABA and the app, generate a token with
   `whatsapp_business_management` + `whatsapp_business_manage_events`.
3. `POST /{WABA_ID}/dataset` to get or create the dataset ID.
4. Fill in the env vars; keep `META_CAPI_ENABLED=false` until the live test
   passes.
