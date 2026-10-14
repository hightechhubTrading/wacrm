# WhatsApp voice calling

Implemented locally on 2026-10-15. Deployment, migration 075, Meta webhook
subscription, account eligibility and a live WhatsApp audio call are separate
activation steps. A read-only check of the linked database confirmed migration
075 was not present during implementation. No real customer was called or sent
a permission request during testing.

## Staff workflow

Open a customer conversation and select the phone icon in its header. The sheet
shows the customer's call history and current Meta calling permission. Select
**Request permission** if needed; after the customer approves, refresh the sheet
and select **Call customer**. Dialing rechecks permission on the server even if
the sheet previously showed approval. Customer opt-outs block outgoing calls and
permission requests.

Incoming calls appear in a floating panel on every dashboard page. Answer,
decline, mute/unmute and end the call there. Keep the CRM open, allow microphone
access and use a headset. Select **Enable ringing on this browser** in the call
sheet to unlock audible ringing; browser autoplay rules can otherwise silence it.
There is a separate **Play audio** action if the browser blocks received audio.
Calls continue during CRM navigation. Leaving/reloading the page sends a
best-effort termination beacon and releases local microphone tracks. If a browser
crashes, reopen the CRM and end the stranded call from the recovery panel.

Existing conversation access rules apply: admins/owners see all account calls;
agents see calls for their assigned conversations. New/unassigned customers ring
admins, rather than exposing their conversations to every agent. Viewers cannot
use calling. A database claim allows only one browser to answer a call, and one
agent can own at most one connecting/active call at a time. A second tab may end
the same agent's stranded call but cannot accept/pre-accept its audio.

## Activation

1. Apply **only** `supabase/migrations/075_whatsapp_calling.sql` using the normal
   database migration process. Check the linked database migration history first;
   local numeric filenames differ from remote timestamp versions. Do not push
   unrelated pending migrations. This adds call history, a private status buffer,
   the service-only event reducer, read policies and Realtime publication. Calling
   defaults to disabled for every account.
2. Deploy this application revision. Existing messaging uses its existing Graph
   API version. Calling defaults separately to `v23.0`; set
   `WHATSAPP_CALLING_API_VERSION` if needed for the verified account/API version.
3. In Meta Developers, subscribe the same app to the WABA **calls** webhook field.
   Keep the existing signed `/api/whatsapp/webhook` callback. The app must have
   `whatsapp_business_messaging` and be subscribed to the correct WABA.
4. In WhatsApp Manager, enable voice calls for the Cloud API number and leave SIP
   disabled. The business must meet Meta's eligibility requirements, including
   the documented 2,000-recipient messaging limit. Configure business call hours
   there. CRM activation verifies Meta calling is enabled and SIP is disabled;
   it does not change those Meta settings or confirm the app's webhook subscription.
5. In **Settings → WhatsApp**, select **Enable CRM calling** as an admin/owner.
6. Test an incoming call, decline, missed call, two competing agents, permitted
   outgoing call, permission denial, microphone denial and interrupted network on
   the actual staff/customer networks. Local synthetic success does not verify
   Meta SDP compatibility, account access, Qatar network connectivity or billing.

## Audio infrastructure

The browser uses WebRTC with Opus audio. The server transports SDP and call
actions through Graph API; Supabase carries persisted state and realtime updates.
Audio does not pass through Next.js or Supabase. No SIP/PBX service is required.

By default ICE uses `stun:stun.l.google.com:19302`. For restrictive networks,
configure a reachable TURN relay with `WHATSAPP_CALLING_ICE_SERVERS_JSON`, e.g.:

```dotenv
WHATSAPP_CALLING_ICE_SERVERS_JSON=[{"urls":"stun:your-stun.example:3478"},{"urls":"turns:your-turn.example:5349","username":"restricted-user","credential":"restricted-credential"}]
```

The authenticated audio-config endpoint intentionally delivers these ICE
credentials to agents' browsers; use restricted credentials and rotate them, or
extend it with your relay provider's short-lived credential service. A TURN
relay's availability and cost are deployment concerns. Microphone access needs
HTTPS (localhost is allowed). The existing Permissions-Policy permits the
same-origin microphone and denies camera use.

## Implementation and reliability

- `src/lib/whatsapp/calling/`: Meta transport, permissions, webhook normalization,
  account/RLS guards, types and non-trickle ICE/media readiness helpers.
- `src/app/api/whatsapp/calls/`: active/history reads, outgoing calls, authenticated
  control actions, permission requests, opt-in settings and ICE configuration.
- `src/components/calling/`: global call provider/panel, customer call sheet and
  settings. English and Arabic strings live under `Calling` in the dictionaries.
- `075_whatsapp_calling.sql`: history, status buffer, read policies, per-agent
  live-call uniqueness, event reducer and Realtime publication.

Signed call events persist before the webhook acknowledges them; database
failure returns 500 for Meta retry. They bypass message-delivery status handling
and AI processing. Permission replies display in the transcript as control
events and do not start flows, keywords or sales AI. The private status buffer
preserves ACCEPTED/REJECTED events that arrive before the connect event. The SQL
reducer serializes duplicate events, correlates early outbound webhooks using
the local UUID and never revives completed calls on late connect/ringing events.

Incoming audio stays muted during pre-accept and is enabled after Meta accepts.
The browser waits for complete ICE gathering before submitting SDP and waits
for media connection before accepting an incoming call. Polling every four
seconds supplements Realtime, including missed updates after reconnect.

This release supports individual voice calls. It does not record audio, provide
transcripts, transfer/conference calls, video, an AI voice agent or closed-browser
push reception. Permission requests from the sheet are free-form and require an
open 24-hour customer messaging window; permission templates outside that window
are not implemented here. Outgoing contacts require a phone number. Incoming
BSUID-only callers can appear to admins but are not attached to a phone contact.
Call history is currently the latest 50 records per conversation. Call records
and status buffers need an operational retention policy; SDP is signaling data,
not a recording. Terminal local hangups clear their stored remote SDP; normal
webhook-completed rows may retain it with their history.

## Verification

- Calling transport, permission, event normalization, route authorization,
  browser ownership, SDP/media readiness and locale parity tests passed.
- The migration ran against an isolated PostgreSQL engine (PGlite): duplicate
  and reordered events, early statuses, outbound correlation, competing claims,
  per-agent live uniqueness, RLS and service-only mutations passed.
- Chrome with synthetic contacts/API responses and two real local WebRTC peers:
  incoming pre-accept/accept, outgoing offer/answer, mute/unmute, CRM navigation,
  hangup and history passed. Desktop/mobile screenshots were inspected. No Meta
  connection or customer call was made.
- TypeScript, ESLint and an isolated production webpack build passed. Existing
  middleware deprecation/Edge-runtime warnings remain.
- Full-suite run: 1,281 tests passed, 27 skipped, one unrelated existing catalog
  search test failed because its ILIKE mock does not match the current multi-field
  search implementation. That route/test was already modified before this task.

Official Meta contracts were read live using their Markdown endpoints:
[incoming calls](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-initiated-calls.md),
[outgoing calls](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/business-initiated-calls.md),
[permissions](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-call-permissions.md),
[settings](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-settings.md).

## Activation progress, 2026-10-15

Migration 075 was applied to the linked app database as
`20261014231133 / 075_whatsapp_calling`, after a live transactional dry run.
Post-application verification confirmed both RLS-enabled tables, the call read
policy, Realtime publication, service-only reducer execution and disabled account
opt-in. A transactional live-schema correlation/ordering probe is kept separate
from real customer calls and rolls back all synthetic records.

Meta read-only verification for **+974 7757 2300**, phone ID
`1207671349096989`, confirmed voice calls and callbacks are enabled. App
`954643353721483` (Hightech) already has an active `calls` webhook subscription
(version `v26.0`) pointing to the existing CRM callback URL. No Meta subscription
was changed and the other subscribed app was left unchanged.

The actual production host is the existing Hostinger VPS Docker Compose project
`wacrm` at `wacrm.srv1795091.hstgr.cloud`; the README's managed-hosting description
is not accurate for this deployment. The running app was built from the
`feat/ctwa-conversions` branch. A separate calling release is prepared from
`182ef46`, containing only the calling feature and its integration points. Other
uncommitted workspace changes are excluded. Its full test suite passed:
**1,231 passed, 27 skipped, zero failures**.

Deployment, account opt-in and real caller audio validation are pending until
recorded below. Temporary deployment SSH access is removed after activation.
