# Work coordinated through WhatsApp groups

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
