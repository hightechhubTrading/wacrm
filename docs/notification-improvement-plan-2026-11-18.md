# CRM notification improvement plan

Date: 18 November 2026. Status: web/server notification release deployed; Android acceptance deferred.

Goal: staff can trust that important work reaches the right person, understand why it needs attention, and act without being overwhelmed by repeated alerts.

This plan is based on the current working tree and project knowledge map. Production schema, configuration, cron cadence and physical-device delivery were not inspected. Existing Android push changes are in progress and must be preserved. No application code, database, deployment or notification delivery was changed while preparing this plan.

## 1. Current implementation and findings

| Area                      | Verified locally                                                                                                                                     | Improvement needed                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app center             | `/notifications` loads the newest 100 rows, groups by day, receives Realtime changes and supports read/mark-all-read.                                | Filters, pagination, useful destinations for system alerts and explicit actions.                                                                                                                                  |
| Unread badge              | `useUnreadNotifications` loads a count once, then applies arithmetic to incoming events.                                                             | Reconcile after reconnect, focus and account changes; avoid repeated updates decrementing the count again and snapshot/event races.                                                                               |
| Event types               | Four types: assignment, invalid AI key, urgent lead and AI handoff.                                                                                  | Follow-up reminders and reply/media reviews currently reuse `ai_handoff`, despite representing different work.                                                                                                    |
| Producers                 | Assignment SQL trigger plus separate handoff, urgency, key-health, review and follow-up helpers.                                                     | Consistent event identity, recipient policy and recoverable production. Handoff can create both an assignment notice and a handoff notice.                                                                        |
| Read state                | Individual updates are optimistic and guarded by `read_at IS NULL`. Mark-all updates all unread rows visible through RLS.                            | Explicit account scope and a fixed cutoff for mark-all; distinguish reading a notice from completing its underlying work.                                                                                         |
| Access                    | Migration 076 requires recipient membership and validates account references when inserting. Push rechecks assignment/session/access before sending. | Decide how old notification details behave after reassignment; in-app reads currently check recipient/membership, not current conversation assignment.                                                            |
| Android transport         | Migration 100, device binding, encrypted tokens, preferences, quiet hours, leases, retries, expiry and source recovery exist locally.                | Finish mobile application integration and verify real delivery before rollout. Native Java work is ahead of the integration status described in `docs/android-push.md`; no push wiring was found in `mobile/src`. |
| Push fanout               | Customer messages target assigned agents and account admins/owners with devices. Staff notices target their recipient.                               | Separate permission to see work from the decision to interrupt someone; admins need an exception policy rather than every-message alerts by default.                                                              |
| Push collapsing           | FCM sends data messages using one `collapse_key: 'crm-updates'`; Android display uses a conversation-specific tag.                                   | A display tag cannot prevent FCM from replacing pending messages from unrelated conversations. Make transport collapsing semantics explicit.                                                                      |
| Follow-ups and operations | AI follow-ups have a reminder loop; quotation follow-up dates and job appointments have their own models.                                            | Add explicit, source-backed reminder adapters after the core is reliable. Do not assume every task has a conversation.                                                                                            |

Principal evidence:

- `src/app/(dashboard)/notifications/page.tsx`, `src/hooks/use-unread-notifications.ts`, `src/types/index.ts`.
- `supabase/migrations/027_notifications.sql`, `058_ai_handoff_notification.sql`, `076_security_boundaries.sql`, `100_mobile_push.sql`.
- `src/lib/ai/{handoff,lead-priority,key-health,reply-review,followup-reminders,notification-recipients}.ts`.
- `src/lib/mobile/push/{worker,fcm}.ts`, `src/app/api/mobile/push/route.ts`.
- `mobile/android/app/src/main/java/com/hightechhub/crm/demo/{CrmMessagingService,PushNotifications,NativePush,NativePushStore,PushSyncWorker,PushContextPlugin}.java`.
- `src/app/api/automations/cron/route.ts`, `src/lib/ai/work-poller.ts`, `docs/android-push.md`.

## 2. Recommended staff experience

Use the notification center for actionable changes and exceptions. Keep ordinary message unread state in the Inbox; avoid inserting a permanent center row for every customer message.

| Event                             | Default recipient                                                | Interrupt policy                        | Destination/action                     |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| Conversation assigned             | Current assignee; retain self-assignment suppression             | Normal                                  | Open conversation                      |
| AI handoff                        | Current assignee; admin/owner fallback for unassigned work       | High                                    | Open conversation and acknowledge work |
| Urgent lead                       | Current assignee; admin/owner fallback                           | High                                    | Open conversation and acknowledge work |
| Reply/media review                | Current authorized owner; admin fallback                         | High when a customer is waiting         | Open the exact review context          |
| Follow-up due                     | Current task owner consistent with source access; fallback queue | Normal; high when overdue               | Open task, complete or defer           |
| AI/provider configuration failure | Admins/owners                                                    | High, once per failure episode          | Open the relevant settings section     |
| New customer message              | Assigned agent; unassigned handling queue                        | Grouped normal alert                    | Open conversation                      |
| Appointment changed/due           | Responsible staff who have access                                | Normal; cancellation/change may be high | Open job/calendar entry                |
| Quotation follow-up due           | Authorized sales owner from the quotation/deal                   | Normal                                  | Open quotation follow-up               |

These are proposed defaults. Account-wide unassigned handling can initially use admins/owners; selecting a duty agent is a later configuration option. Never broaden data access to make a notification destination work. Workers without CRM membership require their existing authorized workflow or a separately designed access model.

Provide Unread / All and category filters (Messages and assignments, Follow-ups, Jobs, System), plus a High priority filter. Each row shows the reason, source reference, time and one primary action. Rows can be marked read independently of opening them. Acknowledging a task uses its existing domain action; reading a notification does not complete work or stop escalation.

Render notification copy and relative dates in English/Arabic using structured message keys and parameters; retain legacy title/body fallback. Include RTL, keyboard navigation, screen-reader unread/priority labels and readable long references. Use a shared notification state source for the page and navigation badges. A compact header bell can reuse it after the core behavior passes acceptance.

## 3. Implementation sequence

### Phase 1 — Correct the existing center and badge (P0)

1. Scope queries, subscriptions, mutations and cached state to account and recipient. Reset on identity changes and ignore late responses from the previous scope. Treat RLS as authorization, with explicit query filters for consistency.
2. Replace arithmetic-only badge tracking with authoritative count reconciliation on initial subscription, reconnect, return to foreground and after successful mutations. Coalesce event bursts, deduplicate IDs and guard against stale requests overwriting newer state. The existing conversation unread counter is a useful pattern, but notification state needs its own adapter.
3. Make mark-all use an account/recipient scope and a server-defined cutoff so newly arriving notices remain unread. Reconcile page and badge after failure or another-device updates. Handle unread rows outside the loaded page.
4. Add cursor pagination ordered by `(created_at, id)`, an unread filter, retryable errors and separate mark-read actions. New realtime rows must not discard older loaded pages or produce an unbounded first page.
5. Route existing `ai_key_invalid` rows to the AI settings area. For removed/inaccessible targets, show a clear unavailable state with no customer details.

Acceptance: count equals the database after reconnect and read actions; repeated read updates never decrement twice; account switches cannot show stale rows; marking all leaves later arrivals unread; users can reach notices older than the latest 100.

### Phase 2 — Define events and make their creation recoverable (P0/P1)

1. Introduce a shared server-side notification contract and recipient resolver under `src/lib/notifications/`. Preserve the assignment trigger and current producers while migrating them incrementally.
2. Add explicit event types: `followup_due`, `reply_review_required`, `media_review_required`; introduce quotation/job types only with their producer adapters. Keep legacy `ai_handoff` rows readable. Historical rows without reliable source evidence must not be reclassified by guessing from English titles.
3. Extend recipient rows with event/source identity, priority, category, structured copy parameters, typed target references and optional supersession/resolution metadata. Keep `notifications` as the per-user read model. Use a shared durable event record for fanout/recovery; reuse current push jobs for device delivery rather than creating a second push queue.
4. Enforce a database uniqueness boundary such as `(account_id, event_key, user_id)`. Event keys describe an occurrence: assignment revision, handoff episode, review attempt, provider-failure episode, or task ID plus due revision/reminder cycle. A conversation ID alone must not suppress future valid events.
5. Persist event intent alongside the source state transition where the existing transaction/RPC can do so. For best-effort paths, add bounded reconciliation from committed source state and durable processing markers. Push recovery only reconstructs jobs for rows that already exist; it cannot reconstruct a handoff notice that was never inserted. Document any producer that still has a loss window.
6. For a single handoff operation, emit one actionable handoff notice and preserve assignment history separately. Use explicit operation/event correlation to suppress the paired assignment alert; avoid time-window heuristics that could swallow unrelated assignments.
7. Define reassignment semantics: old actionable notices become superseded/unavailable; new ownership receives an appropriate event. Redact source details when access is lost. Recheck current authorization before details/actions and before channel delivery.

Acceptance: retries/concurrent workers create one recipient row per occurrence; distinct episodes still alert; injected producer/fanout failures recover from durable evidence; one handoff produces one interruption; removed/reassigned staff cannot read newly restricted details or act through old links.

### Phase 3 — Control noise and connect actions (P1)

1. Store per-account/user channel and category preferences; extend or migrate the existing mobile preferences without resetting opt-in or quiet hours. Keep device registration separate from user preferences.
2. Separate delivery channels: durable in-app history, foreground toast, optional sound and Android push. Ask for OS permission from a clear user action and show blocked/unconfigured states. Select one tab to present foreground sound/toasts; other tabs still refresh state.
3. Coalesce routine message bursts by conversation. Suppress routine foreground interruptions only when that user is actively viewing the exact conversation; retain unread and high-priority workflow state. Treat online presence as insufficient evidence that a person saw an alert.
4. Stop routine every-message fanout to all admins by default; notify them about unassigned work, unresolved escalations and system incidents. Offer explicit supervision subscriptions.
5. Keep quiet hours authoritative on the server with the saved IANA timezone, initially defaulting to Asia/Qatar as the mobile contract does. Expire stale push alerts; leave outstanding work visible in the center. Any high-priority override must be an explicit preference. OS notification permissions and Do Not Disturb remain authoritative.
6. Add Complete/Defer/Acknowledge actions through existing task APIs with current access and state checks. A failed action retains the unresolved state and explains how to retry. An acknowledgment is source-specific, not a generic write granting workflow authority.

Acceptance: a message burst gives one routine interruption per configured window; open-conversation suppression works; multiple tabs do not all sound; quiet hours and preferences survive app changes; reading a notice does not silently complete or acknowledge its task.

### Phase 4 — Finish Android delivery and make it observable (P1)

1. Reconcile the current native Java work with `docs/android-push.md`; complete permission/settings UI, registration, token rotation, bridge-offline recovery, logout cleanup and authenticated tap navigation in the mobile React app. Reuse the existing binding/version/revocation contract.
2. Fix the collapse contract before pilot: either use a collapsed wake-up hint that synchronizes all authorized outstanding work, or keep independent actionable alerts non-collapsible with short TTLs. Do not replace the single key with unlimited per-conversation keys: FCM supports only four simultaneously stored collapse keys per token. Keep conversation display tags for visible-card replacement; they serve a different purpose from transport collapse. [FCM collapse behavior](https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types).
3. Verify payload deadline enforcement at the native display boundary, delayed/reordered delivery, multiple conversations, generic lock-screen content and clearing alerts on logout. Expired hints must not resurrect old work. Keep customer names, text, media and prices out of provider payloads.
4. Measure the actual cron schedule and queue capacity before setting a delivery promise. The current worker claims 20 jobs per invocation, so a once-a-minute schedule has a nominal ceiling of 20 attempts/minute before retries and fanout. Isolate push draining from slow automation/reminder work using the existing deployment's worker/scheduler pattern, bounded batches and lease checks. Avoid adding a new queue service without measured need.
5. Record structured outcomes: queued, claimed, provider-accepted, deferred with reason, discarded, expired and terminal failure. Add opt-in app receipt/display/open acknowledgments if required, authenticated to the active binding and without customer content. Report provider acceptance separately from confirmed app receipt; unavailable receipts are unknown.
6. Expose an admin health view with last successful drain, oldest due job, queue depth, retry/expiry rates, configuration status and device permission/registration health. Alert operators through an independent infrastructure channel when the notification path itself is down.

Acceptance: synthetic transport tests and isolated SQL checks pass, then foreground/background/terminated-app physical-device checks pass with the intended Firebase project. Test offline reconnect, permission denial, token change, expired session, reassignment and logout. Verify the current Firebase/app setup rather than treating local code as proof of configuration. Android rollout remains blocked on those checks; iPhone and browser push are later scope.

### Phase 5 — Reminders, escalation and operational coverage (P2)

1. Add adapters for quotation follow-up dates and job appointment changes/reminders. Normalize each source's owner, due time, revision and resolution state through the shared contract. Date-only follow-ups use an explicit business-timezone reminder time. Resolve profile IDs versus Auth user IDs at the source boundary.
2. Avoid parallel reminder engines: move scheduling/claims into the shared durable process while preserving the existing AI follow-up APIs. During migration, ensure cron and optional in-process polling cannot issue duplicate reminder cycles.
3. Escalate unresolved high-priority work once to the configured fallback after an account-configured SLA. A read receipt or provider acceptance does not count as acknowledgment. Recheck owner, due revision, cancellation, completion, access and quiet hours before each escalation.
4. Pilot defaults can start with 15 minutes for unacknowledged handoffs/urgent work and one daily summary for ordinary overdue follow-ups. Treat these as configurable trial values, measure staff workload and adjust before account-wide activation.
5. Add resolution-aware cleanup so completed, cancelled or deferred work stops pending reminders. Keep appropriate history while excluding resolved work from action-needed counts. Define retention separately for recipient history and short-lived delivery telemetry; retain the current seven-day push-job cleanup until a measured reason to change it exists.

Acceptance: completing or rescheduling a task cancels stale reminders; owner changes route future alerts correctly; repeated cron invocations cannot duplicate an escalation cycle; quotations/jobs without conversations open the correct authorized screen.

## 4. Verification and rollout

For implementation, read the relevant installed Next.js guides before modifying routes/components. No AI model, Jev prompt or customer-message behavior change is required for this notification plan.

- Unit/behavior tests: event keys across separate episodes, routing fallback, repeated read events, snapshot/event races, quiet-hour policy and resolution rules.
- Isolated PostgreSQL tests: RLS and column grants; cross-account references; event uniqueness; atomic fanout/claiming; source recovery; reassignment and concurrent completion/reminder races. Extend `scripts/test-mobile-push.sql` and the existing fixture runner for transport changes.
- Browser/mobile tests: pagination with live arrivals, multi-tab/device consistency, offline recovery, denied permissions, unavailable links, EN/AR and RTL, keyboard/screen-reader actions, and no stale details after identity/access changes.
- Device tests: pending updates for several conversations, TTL/quiet-hour boundaries, rotation/revocation, background/terminated delivery and reauthentication before opening a target.
- Operational checks: migration preflight, publication/RLS state, scheduler heartbeat, sustained burst capacity and provider outage recovery. No real customer sends are needed to validate this feature.

Release order: Phase 1 → additive event schema and producer migration → preferences/actions → verified Android pilot → new operational adapters and escalation. Additive migrations precede dependent code. Keep old event rendering during rollout and do not renumber/rewrite migration 100 while its current work is being coordinated. Use the project's reviewed migration/deployment process rather than broad legacy `db push`.

Pilot with a small internal cohort first. Enable delivery and escalation separately; a transport or policy flag can pause interruptions while preserving center history and pending work. Roll back application behavior by flags/compatible code, retaining durable records for reconciliation.

Proposed acceptance targets, to validate against a measured baseline:

| Measure                         | Initial target                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Badge/center convergence        | Within 5 seconds after a successful foreground/reconnect refresh under normal connectivity             |
| Internal event creation         | p95 within 5 seconds for immediate producers; scheduled sources within one measured scheduler interval |
| Push provider acceptance        | p95 within 60 seconds for eligible online work outside quiet hours, after proving scheduler capacity   |
| Duplicate recipient records     | Zero for the same recipient/event occurrence in concurrency and replay tests                           |
| Unauthorized disclosure/actions | Zero in cross-account, departed-member and reassignment fixtures                                       |
| Notification usefulness         | Review actionable notices, acknowledgments, repeated alerts and staff feedback during the pilot        |

Provider acceptance and device delivery are different measurements; do not promise a fixed end-to-end receipt time from a successful FCM response. [FCM delivery reporting](https://firebase.google.com/docs/cloud-messaging/understand-delivery). Realtime should trigger reconciliation with authoritative state when missed updates matter. [Supabase guidance](https://supabase.com/kb/troubleshooting/realtime-postgres-changes-troubleshooting).

## 5. Recommended first implementation slice

Start with Phase 1 and explicit review/follow-up event types from Phase 2. This immediately makes the existing center trustworthy and understandable while the Android integration proceeds. Then deliver durable event production and deduplication before enabling broader push fanout or escalation. Keep browser push, iPhone delivery, external staff WhatsApp alerts and AI-based notification ranking outside this first rollout.

## Execution record — 22 November 2026

Implemented locally:

- Phase 1: account/user/role scoped lifecycle, coalesced authoritative unread refresh, reconnect/focus recovery, stale-request disposal, stable timestamp/ID history pagination, unread/category filters, independent Open/Mark read actions, server-cutoff mark-all RPC, and English/Arabic controls and dates (including the route translation payload).
- Explicit `followup_due`, `reply_review_required` and `media_review_required` types now used by their producers. Existing historical types remain valid; legacy records are not guessed/reclassified.
- Migration 101 adds the type constraint, recipient pagination index, scoped invoker mark-all function, conversation-visibility SELECT policy and read-only deployment sentinel. Deployment preflight refuses a candidate without that sentinel. **Migration has not been applied.**
- AI-key notices open Agents → Setup. Conversation destinations are checked through current RLS before navigation. Reading notices remains separate from source task completion.
- FCM data updates no longer share a collapse key; native conversation display tags remain unchanged. The transport test asserts the absence of the key.

Verification so far: production build, TypeScript and focused lint passed; 109 focused behavior/transport tests and 51 deployment preflight tests passed. The final full backend suite passed 1,892 tests with 74 existing skips (225 passing test files). The 21st local review reported zero findings; hosted inspiration search was unavailable (401), so the implementation reuses project components and tokens. PostgreSQL migration execution and browser/device acceptance have not been run in this environment.

Still pending from the full plan: durable event ledger/fanout reconciliation and correlated handoff deduplication; structured localized event bodies; channel/category preferences and foreground coordination; source-task actions; native React push integration and physical-device delivery; health monitoring; quotation/job adapters and escalation. No phase beyond the listed changes should be treated as completed. Firebase project/credential location was requested for the Android pilot; no credential contents are needed in chat. Production deployment remains separate from local implementation.

### Durable delivery, preferences and task actions — 22 November 2026

The next authorized slice is implemented locally in migration 102 and the
notification components. This supersedes the corresponding pending items above.

- All existing notification inserts stage private recipient events. A bounded SQL
  drain creates visible notifications and schedules the existing mobile queue.
  Row locks and unique event IDs prevent delivery replay from duplicating rows.
  Failed recipient deliveries retry independently up to ten attempts, with SQLSTATE
  error codes and a one-minute retry delay; failed rows remain available for review.
- Handoff, urgent-priority and provider-key-failure transitions capture intent in
  the source transaction. Handoff episode IDs suppress the paired assignment and
  explicit helper duplicate; urgency/key episodes also deduplicate helper inserts.
  Episode identifiers cannot be supplied by ordinary source updates. A rolled-back
  source transition leaves no event. These source transactions now fail together
  if durable intent cannot be persisted; they no longer pretend success while
  losing the associated source notification. Existing handoff error handling remains.
- The existing secret-authenticated automation cron and optional AI work poller
  drain events. No new device transport or external queue service was added.
- Follow-up rows carry exact task IDs. Retry staging deduplicates by task, due
  timestamp and UTC reminder day. Completing/cancelling/rescheduling a follow-up
  resolves previous notices, cancels pending events and discards pending/leased
  push jobs. Fanout rechecks current membership, assignment and task state.
- English/Arabic push-category preferences are available in the center. Categories
  are messages/assignments, attention, follow-ups and system. Preference changes
  preserve durable center history and existing mobile opt-in/quiet-hour settings.
  Category policy is checked at queue insertion and immediately before transport;
  service credentials cannot invoke the preparation function that bypasses it.
- Source-linked follow-up notices offer Acknowledge, Complete (with evidence) and
  Defer (with a future date in the user's local timezone). They use the existing
  follow-up API's authorization, validation and state conflict handling. Read state
  remains separate; acknowledging still allows completion/defer actions.
- Deployment preflight requires the migration 102 readiness sentinel. The migrations
  are prepared, not applied. Verify the actual scheduler cadence/availability before
  promotion; staged events need the drain to appear in the center.

Validation: full backend suite passed 1,892 tests (74 existing skips), 52 deployment
preflight tests passed, production web build and TypeScript passed, focused lint and
local 21st review passed. Isolated in-memory PostgreSQL executed migrations 100–102
and checked staging/replay, source rollback, handoff/urgency/key episodes, injected
fanout failure/recovery, reassignment, task resolution, RLS/grants, preference changes
on leased push work and source-revision spoofing. These tests do not establish
multi-connection production concurrency behavior.

Synthetic desktop Chrome checks passed for category saving, task acknowledgment,
completion evidence, deferral timezone conversion, failed-action preservation and
Arabic controls. The harness uses synthetic services and the installed desktop
browser; it does not connect to CRM/Firebase. Android builds, emulators and device
checks remain deferred. No production records, provider calls or customer sends
were involved.

Reproduce the isolated checks with `scripts/test-notification-delivery.mjs`
(`PGLITE_MODULE` pointing to an installed `@electric-sql/pglite` module) and
`scripts/test-notification-ui.mjs` (`ESBUILD_MODULE` pointing to an installed
`esbuild` module; `CHROME_EXECUTABLE` may select an existing Chrome installation).
Test-only packages were installed in a temporary directory, not added to the app.

Remaining: review/media producer crashes before their staging call are not yet
reconstructed from source state, and repeated independent review attempts retain
separate event IDs. Foreground toast/sound coordination, routine message grouping,
admin supervision routing, structured localized event bodies, delivery health UI,
quotation/job adapters, escalation and production multi-connection acceptance remain
open. Android integration/device testing and production rollout remain separate.

### Web/server completion and database rollout — 22 November 2026

The web/server remainder is now implemented. This supersedes the older pending
lists above; Android integration/build/device acceptance remains deferred.

- Review event/media-state triggers capture durable intent before helper calls.
  Source message/reason and media operation keys correlate retries. Successful
  attachment delivery resolves its review notice.
- Quotation follow-ups use the recorded owner/profile ID, due-date revision and
  account timezone. They alert once per revision/day while draft or sent and
  active. Initial activation does not replay old overdue dates. Appointment
  creation/change/cancellation and one-hour reminders use responsible staff and
  booking revisions. Source changes cancel stale notices. New targets remain
  guarded by current quotation/job RLS and delivery-time owner checks.
- Notices have localized type titles/body templates, source references, priority
  and category. Recorded customer/staff text remains evidence rather than being
  silently translated. Legacy titles/bodies remain unchanged.
- A focused-tab foreground component coalesces message bursts, suppresses routine
  alerts in the active conversation, uses Web Locks/storage for cross-tab dedup,
  respects categories/quiet hours, and provides optional sound (off by default).
  Browser autoplay/Do Not Disturb still govern actual audio. Unsupported Web Locks
  suppress interruptions while leaving the center available.
- Preferences now cover categories, foreground alerts, optional sound, supervision
  of others' conversations and paired quiet hours with a validated timezone.
  Quiet-hour changes preserve existing push opt-out. Supervisors receive routine
  assigned-message pushes only when opted in; source authorization still applies.
- Explicit notice acknowledgment and existing task acknowledgments prevent SLA
  escalation. Read state alone does not. Completed/rescheduled work, recorded human
  replies, restored provider keys and closed conversations prevent stale alerts.
  Escalation is once per event to other admins; the admin health panel offers
  account opt-in and a 5–1440-minute delay (default 15, initially disabled).
- The health panel reports heartbeat, pending/failed work and push configuration;
  admins can retry terminal failures. An explicit runtime worker drains every
  15 seconds. A database-only systemd timer provides a fallback during rolling
  updates, and an independent read-only watchdog reports failures to systemd/journal
  every two minutes. External email/Slack alert delivery is not configured.
- Cursor queries, queue claims, reminder selection and retries are bounded.
  Reminder scans exclude already-scheduled occurrence keys so earlier records do
  not starve subsequent batches. Events remain private to server roles.

Live database migrations, through the linked timestamped process:

| Source                           | Recorded version |
| -------------------------------- | ---------------- |
| 100 mobile push server schema    | 20261122151450   |
| 101 notification center          | 20261122151451   |
| 102 durable delivery             | 20261122151452   |
| 104 notification operations      | 20261122151453   |
| 105 acknowledgment lock ordering | 20261122152221   |

Migration 103 was already applied and was not replayed. The required private
contact-photo bucket was already correctly configured. Source SQL was compared
against the applied artifacts. Previous assignment-function/policy metadata is
retained in the Git-ignored `.local/notification-release/` directory. All three
notification readiness sentinels and the complete live deployment database
preflight passed; the database worker reported healthy with zero terminal failures.

Verification: 1,915 backend tests passed (74 existing skips), 53 deployment checks
passed, TypeScript passed and lint had zero errors (32 existing warnings). The
production web build passed. A disposable PostgreSQL database checked the actual
migrations, role grants, source rollback, revision changes, reminder cancellation,
quiet-hour opt-out preservation, review/media recovery and two-connection SKIP
LOCKED behavior; fixture databases/roles were removed. Synthetic installed-Chrome
checks covered EN/AR preferences and task actions, local-time deferral, failed
writes, focused-tab interruption and duplicate suppression after a tab switch.
No emulator, Android build or device test was run.

Release source is prepared on `feat/notification-release`, based on the existing
committed CRM branch, to preserve unrelated unfinished native changes. CI on this
branch runs web/backend and real PostgreSQL checks without the Android workflow.
The updater supports a server-owned `.release-branch` pin; deployment retains the
existing resource limits, candidate database/PDF/auth checks and rollback image.
Application promotion and final live evidence are recorded after verification.

Remaining acceptance is operational: staff feedback, sustained-load measurements,
audible sound on staff devices and Android app/physical delivery acceptance.
No unmeasured end-to-end push latency is promised. Older source history is retained;
no bulk history deletion or external messaging-channel activation was performed.

Lock-order acceptance: migration 105 makes notice acknowledgment use a NOWAIT event
lock. The real two-connection fixture verified an immediate retryable rejection
while a drain owns that event and successful acknowledgment after release. This
prevents the notice/event lock order from becoming a deadlock. Migration 105 is
recorded as `20261122152221`, and live preflight requires its implementation.

### Live application verification — 22 November 2026

The web/server release is live at `https://wacrm.srv1795091.hstgr.cloud`.
Deployed source is `63cff2603e93937d32291be51c67546f8ac87e34` on
`feat/notification-release`. [GitHub CI](https://github.com/hightechhubTrading/wacrm/actions/runs/45038121427)
passed for that exact source, including lint/typecheck, 1,915 backend tests,
53 preflight tests, real PostgreSQL isolation/concurrency checks and production
build. The server's resource-capped build and updater then passed candidate
database/PDF/auth checks, active-call gating, public HTTPS and revision checks.
The verified rollback image is retained as `wacrm:rollback`.

Post-promotion checks:

- Running `.next/REVISION` matches the deployed source; notification worker is
  enabled. Firebase production sending remains unconfigured as intended.
- All notification schema sentinels are ready; the database worker is healthy
  with zero terminal failures.
- Maintenance and watchdog timers are active; the watchdog completed with
  `Result=success` and exit status 0.
- Public `/login` and the client-auth-gated `/notifications` shell return 200.
  Anonymous `/api/notifications/settings`, `/api/notifications/health` and
  `/api/whatsapp/calls` return 401. The notification shell's 200 response is
  expected; source records and actions remain protected by API/RLS authorization.
- Disposable notification fixture databases and roles on the test host both
  have count zero after cleanup.
- The shared workspace now tracks the release branch; earlier unfinished native
  changes were preserved and excluded from this commit. Pre-integration patches
  and source files are retained under Git-ignored `.local/notification-release/`.

Escalation remains an explicit per-account admin opt-in (15-minute default), and
sound remains off by default. No Android build, emulator, physical-device test,
production Firebase activation or external staff messaging was performed.

Final deployment cleanup: the temporary notification-release SSH key was removed
from the VPS; a fresh connection with that key was verified denied. Its local
private/public files and temporary UI-test dependencies were removed. Existing
unrelated deployment keys and the deferred native working-tree changes were left
untouched. A final live check reconfirmed source `63cff26`, required server
configuration, an enabled notification worker, successful watchdog status and
protected notification APIs. Rollout documentation is pushed separately from the
unchanged deployed application source.

### Notification-page repair — 22 November 2026

A live, synthetic-auth browser reproduction found that the sidebar and notification
page mounted `useUnreadNotifications` with an identical Supabase Realtime topic.
The singleton client returned its already-subscribed channel to the second hook,
whose `.on()` call threw and activated the route recovery screen. Database reads
and public HTTP health checks therefore passed while the authenticated page failed.

Each hook effect now owns a unique channel topic, including effect restarts, and
removes that channel on disposal. A full-page browser regression test mounts
multiple count readers with channel reuse semantics, real translation providers
and both EN/AR locales. It reproduced the old crash and passes with the fix.
The previously used component-only fixture did not cover this shell/page interaction.
