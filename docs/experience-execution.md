# Experience implementation — complete local handoff

Completed 30 October 2026 against the local working tree. Implements the committed
experience improvements in [the review and plan](experience-improvement-plan-2026-10-30.md).
The user confirmed that this task should finish **code and automated QA**, with
**the team running the staff/physical-device pilot**. Production rollout is separate.

## Completed implementation

- [x] Recoverable drafts scoped by account, user and conversation, including text,
      reply target, completed attachments, interactive messages and template values.
      Clear on logout/account changes; invalidate stale writers; use seven-day text
      and one-day attachment-metadata expiry with in-memory fallback if storage fails.
- [x] Guard late AI/translation/upload/microphone results and preserve newer manual
      text with explicit Insert/Replace. Stop recording on navigation and clean uploads
      that cannot be retained, including the account-reset race.
- [x] Safe text/media/interactive/template send recovery with stable operation IDs,
      server-side unique claims, explicit acceptance/rejection/unknown outcomes, durable
      recovery state, and Retry/Edit/Discard only where the outcome permits it.
- [x] Persistent browser connection/offline notices, last live-connection time,
      last successful queue-refresh timestamp, retry and reconnect resynchronization.
      Contacts distinguish failed, stale, partial, empty and no-result states.
- [x] Route/global recovery boundaries, useful not-found destination, skip link,
      translated status vocabulary and focused recovery heading.
- [x] URL-restored inbox filters/sort, device-scoped named views, historical message
      search across all authorized history, stable paging, and bounded result context
      with return-to-latest/reply actions. Validate calendar inputs before SQL reads.
- [x] Work/Growth/Manage navigation and Today/Inbox/More phone navigation. Closed
      phone drawers cannot receive focus; focus traps/restores correctly and resizing
      to desktop releases the drawer state. Preserve Contacts/Pipelines route labels.
- [x] Visible keyboard viewport sizing without overriding pinch zoom, essential
      phone touch targets, long-reference wrapping and bilingual layout checks.
- [x] Connected selected-job overview: stage, owner, latest/accepted quotations,
      measurement result, blocked work, requested date and next action. Combine dated
      quotation creation and work updates into a recent history with source links.
      Terminal measurement links open the exact completed record. Work, accepted
      quotations and latest quotation failures remain separate and can be retried.
- [x] Bounded overview reads: 50 work requests, 20 updates per request and 25 recent
      quotations; display up to 20 combined history entries and disclose those bounds.
      The overview does not sign attachment URLs; opening the source loads its evidence.
- [x] Advisory teammate viewing/composing indicator with explicit assignment,
      authorized ephemeral heartbeats, expiry and monotonic leave protection. Realtime
      invalidations read without heartbeat writes; hidden conversations stop polling.
- [x] Qatar business time (`Asia/Qatar`) for every user: Today, follow-up/job inputs,
      message/search dates and operational dashboard buckets agree across client zones.
- [x] Privacy-conscious diagnostics: runtime-allowlisted, bounded session-local
      counters and numeric timings for send/reconciliation, queue recovery and quotation
      saves, plus route-failure counts. No message text, customer identifiers, search
      queries, raw errors or file paths are retained/exported by these helpers.
- [x] Prepare the [staff pilot and baseline worksheet](experience-staff-pilot.md)
      focused on replying and following up, as selected by the user.

## Final verification

| Check                                             | Result                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest suite                                 | 1,567 passed; 68 skipped; 190 files passed, 3 skipped                                                                                                                                                      |
| TypeScript                                        | Passed                                                                                                                                                                                                     |
| Focused ESLint and formatting                     | Passed                                                                                                                                                                                                     |
| Production webpack build                          | Passed; 75 pages generated                                                                                                                                                                                 |
| Deployment preflight tests                        | 23 passed                                                                                                                                                                                                  |
| Send-operation SQL fixture                        | Passed unique claim and actor/tenant/assignment/viewer/anonymous boundaries                                                                                                                                |
| Historical-search SQL fixture                     | Passed paging, Arabic/transcripts, dates, context and access boundaries                                                                                                                                    |
| Activity SQL fixture                              | Passed authorization, sequence/tombstones, composing expiry and stale-peer filtering                                                                                                                       |
| Composer browser fixture                          | Passed draft isolation/reload/cross-tab, late results, send recovery, attachments, templates and microphone cleanup                                                                                        |
| Recovery browser fixture                          | Passed contacts failures/retry/stale/partial states, reconnect, Qatar sync dates, bilingual actual sidebar focus/resize, activity expiry/visibility/switch/errors and keyboard viewport/zoom               |
| Historical-search browser fixture                 | Passed URL/back/reload, scoped saved views/blank-name validation, search filters/paging/context/reply and Arabic phone                                                                                     |
| Job-overview browser fixture                      | Passed explicit selection, independent failures/retry, terminal source selection, workshop snapshot preservation, history ordering, stale switch, 360/390px/desktop layouts, 200% zoom and long references |
| Sales Today browser fixture                       | Passed direct reply/follow-up/job entry, actions/retry, event refresh, auth changes and 12 bilingual layouts                                                                                               |
| Phone handoff browser fixture                     | Passed report routing/save/retry, request preparation, duplicate prevention, attribution, workshop acceptance gate and 36 bilingual layouts                                                                |
| Existing production-component performance fixture | Passed bounded loading, hidden-tab behavior, reconnect reconciliation and stale auth protection                                                                                                            |
| 21st deterministic review                         | Zero findings for updated job summary, connection notice, sidebar and recovery panel                                                                                                                       |
| Whitespace diff check                             | Passed                                                                                                                                                                                                     |

The development fixtures now isolate their Vite caches so concurrent checks cannot
invalidate one another's optimized dependencies. Screenshots were visually reviewed
with project inspector tokens and the bundled Arabic font. Illustrative fixtures:
[English job overview](experience-evidence/job-overview-en-390.png) and
[Arabic job overview](experience-evidence/job-overview-ar-390.png).

## Reproduction

```sh
npm test
npm run typecheck
node --test deploy/check-database.test.mjs
PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/check-send-operations-db.mjs
PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/check-message-search-db.mjs
PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/check-conversation-activity-db.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-experience-browser.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-recovery-browser.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-inbox-search-browser.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-job-overview-browser.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-sales-today.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-phone-handoff.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-performance-browser.mjs
npm run build -- --webpack
```

## Team-owned rollout and boundaries

At the local implementation handoff no production migration or deployment had
occurred, and no real customer message was sent. The subsequently authorized live
release is recorded below. Apply migrations **087, 088 and 089** in staging and run the documented database
preflight before rollout. The team owns staff observations/baselines, physical
Android/iOS microphone/share/keyboard checks, real test-recipient delivery checks
and the production release decision, per the user's final scope clarification.
Synthetic fixtures do not establish staff task-time improvements or production latency.

Acceptance recorded by the send ledger is distinct from delivery/read status.
Provider acceptance can remain unknown if the provider response is lost before
acceptance is recorded; the application deliberately does not automatically resend
in that case. Activity is advisory rather than a cross-agent send lock. Draft
attachment expiry removes local metadata, not a claim of server-wide media garbage
collection. The combined history is a bounded source overview, not a complete audit
log; current quotation status does not invent an acceptance timestamp. Requested
visits remain unconfirmed, and issued workshop snapshots remain immutable.

Optional feature candidates in the original review (shared views, escalation,
contact merges, external approvals, offline/native features) remain discovery
backlog, rather than unfulfilled implementation commitments. The conversation
collision indicator is the selected feature implemented for this pilot.

## Authorized production release — 30 October 2026

The user explicitly requested commit, push and deployment after accepting the
code/automated-QA handoff and assigning the staff pilot to the team.

- Application commit **94e97dc9b9efba03bf1f840bdbac043d79585092** was pushed to
  `feat/ctwa-conversions` and promoted by the existing VPS updater.
- Only reviewed migrations 087–089 were applied, atomically, through the linked
  timestamped process. Recorded versions: **20261030153929** (087),
  **20261030153930** (088), **20261030153931** (089). The PostgREST schema cache
  was refreshed. No numeric-directory bulk migration push was used.
- Live read-only validation passed authenticated search/context/activity shapes,
  cross-tenant empty results, table RLS, denied browser mutation privileges and
  anonymous/service-role heartbeat restrictions.
- The VPS production build, candidate database preflight, authentication/PDF
  smoke checks, no-active-call gate, public login and exact revision check passed.
- Post-promotion checks confirmed the running revision, database preflight,
  protected inbox/quotation/calling/search/activity/job endpoints, all eleven
  anonymous RPC denials, and a public browser login/inbox redirect without page
  errors. Public site: <https://wacrm.srv1795091.hstgr.cloud>.
- Running image: `sha256:7e9ddc4575d10f038d354d6db189e89907447cd995617c2b2304cb62e974d849`.
  Verified rollback image `wacrm:rollback` retains previous application revision
  **1b0b4f9caef5418a746096634b3a29999838306d**. Database changes are additive;
  the updater's rollback restores the app image, not migration history.
- The exact temporary root SSH key was removed; Hostinger confirmed no remaining
  root deployment keys. Private release evidence is retained at
  `~/.local/state/wacrm/releases/experience-20261030/` without the private key.

The separate design changes that appeared during deployment were not included in
this release and were preserved locally. Staff/device pilot results remain owned
by the team; this deployment does not claim those observations or real customer
message-delivery verification. No real customer message or call was sent by these
release checks.
