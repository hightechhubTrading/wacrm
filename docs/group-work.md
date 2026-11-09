# Work coordinated through WhatsApp groups

## Company calendar and preparation defaults — 9 November 2026

The user selected **one shared company calendar, with one appointment at a time**, and **CRM members as responsible people, defaulting to the requester**. The local implementation adds `/calendar`, linked from navigation and request preparation. It shows day/week views of measurement visits and installation reservations. Workshop/installation requests reserve an installation time; this does not declare manufacturing ready, customer acceptance or WhatsApp posting.

New requests require a current agent/admin/owner from the account and a free future interval. The requester is selected by profile ID, not a free-text name. Duration defaults to 60 minutes and is editable from 15 minutes to 24 hours. Dates and times use Qatar time. The date control reuses the accessible app calendar with its visible SVG icon; native date/time controls also receive the correct light/dark color scheme.

Preparation uses the customer's latest accessible WhatsApp location pin or recognized Google/Apple Maps link. The source message ID/time are returned with the default. It does not infer an address from arbitrary conversation text. The location stays editable, browser address autofill is disabled, and reloads preserve a salesperson's manual correction. Failed defaults do not prevent reading reports/history; missing staff or calendar availability blocks new booking.

Migration **097_company_job_calendar.sql** adds appointments, responsible profile references, atomic create/reschedule functions and an account-wide GiST exclusion constraint on reserved time ranges. Adjacent appointments are allowed; overlaps are rejected even for different responsible members, hidden deals or competing requests. A conflict rolls back the request and returns HTTP 409. Rescheduling uses an appointment revision and updates the handoff date/person and audit event atomically. Cancellation/completion releases capacity while retaining calendar history. Initial and changed reservations are recorded in the work history.

Earlier requests are listed as **Requests without a calendar reservation**. Their old requested dates are preserved; no duration or responsible-member match is invented. Sales can reserve a time for each from the calendar. If a responsible member leaves, the reservation remains held and is flagged for reassignment; name snapshots remain historical evidence. The tenant trigger now validates the creator on insertion and preserves immutable ownership on updates, allowing authorized staff to continue work after the original creator leaves.

Calendar detail reads use deal-assignment RLS. Service-role reads supply only anonymous occupied intervals for other jobs in the same account, so hidden appointments still prevent double-booking without exposing their customer details. Mutations are session/role gated and tenant/actor IDs are server derived. Booking functions are service-only and validate deal access, current membership and accepted-quotation ownership themselves.

Apply only migration 097 through the linked database's timestamped migration process before deploying this revision. It is additive and compatible with the prior app; it does not create appointments, change earlier requests or send messages. Startup/deployment preflight checks its columns, relationship, capacity constraint, lifecycle trigger, privileges and denied identity-free booking probes.

Verification commands:

```sh
npx vitest run src/app/api/jobs src/lib/jobs src/lib/business-time.test.ts src/i18n/message-scopes.test.ts messages/locale-parity.test.ts
node --test deploy/check-database.test.mjs
node scripts/check-job-calendar-db.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-phone-handoff.mjs
```

The database harness uses disposable PGlite with `btree_gist`; set `PGLITE_MODULE` to an installed `dist/index.js` when it is not available at the default import. It exercises the actual migrations, including competing requests, full-interval overlap, adjacent slots, atomic rollback, member/account/assignment boundaries, frozen quotation snapshots, revisions, legacy requests and slot release. Browser fixtures exercise actual components with intercepted writes, including location prefill/override, member defaults/selection, unavailable durations, calendar failure, rescheduling, legacy booking, icon contrast and 48 English/Arabic phone/laptop layouts. Real customer bookings and device share sheets remain separate from synthetic checks.

## Phone handoff refinement, 29 October 2026 — local

The sheet separates Updates, New request and Add report. Inbox visit/workshop shortcuts open preparation; Add report opens eligible measurement requests with the report action selected. Prepared requests must first be explicitly recorded as posted. Multiple eligible records remain visible for explicit selection; no request is guessed. Existing active work prevents preparing another request of the same kind in this UI.

Request type and applicable update actions use touch-sized buttons. The optional responsible-person label is collapsed; existing location, instruction, date and accepted-quotation validation remains. Evidence-required actions explain the requirement and cannot be saved without a sufficient note or an attachment. Phone fields use readable text and the sheet uses the full phone width.

Prepared messages expose device sharing and copying. Share cancellation does not show an error; unavailable sharing points to copying. No share or copy result records posting, delivery or completion. This does not add WhatsApp group connectivity, worker login, camera/voice recording or push notifications.

Run `node scripts/check-phone-handoff.mjs` for isolated browser checks using synthetic records and mocked API writes. Install the Playwright browser first, or use `PLAYWRIGHT_CHANNEL=chrome` with installed Chrome. `PHONE_CHECK_ARTIFACTS=/absolute/output/path` optionally saves screenshots. The harness mounts the production component and styles with a stubbed edit capability; it does not prove production permissions, device share-sheet behavior or live WhatsApp delivery. Existing API/workflow tests cover the server boundaries.

Local validation passed: 31 focused workflow/API/translation tests; report entry, save/retry, request creation, duplicate-active guidance, sharing/cancellation/fallback and workshop-gate browser checks; 36 layouts at 360/390/1280px in Arabic/English and light/dark; TypeScript, scoped ESLint and the production webpack build. The build required the existing `/tmp` output workaround: `NODE_PATH` and a temporary `/tmp/node_modules` symlink, removed after the check. No customer message or production migration was sent or applied.

Workers continue using their existing groups. Sales uses **Pipelines → Group work** on a deal to prepare a measurement request, copy it into WhatsApp, and explicitly record posting. No group connection or automatic message sending is introduced.

A stable HTH job reference is shared by all measurement and workshop requests on the deal. Location, instructions, optional responsible-person label and requested date are entered by sales. The date is a request, not a confirmed appointment.

Sales pastes a worker's report or uploads forwarded photos, PDF/XLSX/text documents or voice notes. Reports remain source material; no AI reading, transcription or automatic measurement extraction is performed here. Measurement completion, readiness, installation, blocking and cancellation require an explanation of at least ten characters or an attachment. Events preserve who recorded the update and when, without claiming the worker submitted it through the CRM.

Workshop requests require a quotation linked to the deal with status `won`. The accepted reference, revision and ordered line descriptions/dimensions/quantities are frozen at preparation. Sales must attach the approved quotation and drawings separately in WhatsApp. Later quotation edits do not change the prepared request. Cancel and prepare a new request to send changed instructions.

The **Waiting work** queue spans accessible deals across pipelines. It includes prepared, awaiting-update, in-progress, ready and blocked work, shows requested dates and highlights overdue work to chase. It refreshes each minute and after recorded changes. It is an internal visual reminder; this version does not send scheduled notifications or contact workers. Up to 100 queue records are shown, with a `+` indicator if more exist.

## Access and storage

Migration `070_group_handoffs.sql` adds job references, handoffs, append-only events and the private `job-reports` bucket. Apply this additive migration before deploying the app. Client reads inherit deal-assignment RLS. Writes require an agent-or-higher API session, authorized deal access, and a server-derived tenant/actor. Direct client table writes and event RPC execution are revoked. State updates and history insertions share one atomic function; a revision prevents stale updates. At most one active handoff per deal/type is allowed.

Attachments are capped at five files, 10 MiB each and 20 MiB total. APIs sign authorized attachment paths for ten minutes. Reload the panel for fresh links. Failed/stale saves remove files uploaded by that attempt. Worker reports are private and are not added to the AI knowledge base.

This workflow does not change sales pipeline stages or automatically mark deals won. Sales records customer acceptance on the quotation and group progress separately. Group activity remains unknown until sales records it.

## Validation

Targeted tests cover workflow ordering, evidence requirements, access gates, accepted-quotation snapshots, private attachment paths and stale-update cleanup. A transactional database dry run verifies active-work deduplication, stable references, atomic event history, required evidence, revision rejection and service-only mutation permissions.
