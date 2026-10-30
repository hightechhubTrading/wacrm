# App experience review and improvement plan

Execution status: [implementation and validation tracker](experience-execution.md); [staff pilot](experience-staff-pilot.md). Qatar business time is the selected calendar for all users.

Initial review prepared 30 October 2026 against the local working tree, including uncommitted performance work. The findings below preserve the original planning snapshot; implementation and final automated verification are recorded in the linked tracker. No production deployment is implied.

## Assessment

The app has substantial capabilities. Its next improvement should be making daily sales work safer, easier to resume, and easier to follow across conversations, quotations and jobs. Adding more modules before closing these gaps would increase complexity.

Preserve the existing shared inbox, assignment and presence, Sales Today agenda, follow-ups, sales context, group-work updates, quotation revisions/documents, contact deduplication, bilingual UI and role controls. Recent local work also implements bounded inbox/pipeline queries, dashboard aggregates, reconnect recovery and lower calling traffic. These are existing foundations, not missing features.

This is a source-based review, not a visual inspection of a running authenticated app, a production audit, or staff usability research. Findings marked **confirmed** describe code paths; their user impact still needs browser reproduction. **Proposals** describe opportunities, not proven demand. Existing test results in project documents were not rerun for this planning task.

## Priority findings

### 1. Isolate and preserve conversation drafts — P0, confirmed

Evidence: `src/components/inbox/message-composer.tsx:156` keeps text and attachments in component state. The composer at `src/components/inbox/message-thread.tsx:1767` and thread at `src/app/(dashboard)/inbox/page.tsx:607` are not keyed by conversation. There is no conversation-change reset or per-conversation draft store in the composer. AI draft requests set text after awaiting a response without checking that the originating conversation is still active.

Consequence: switching directly between chats can retain the previous customer's unsent text or staged attachment. A delayed AI response can replace the draft now being viewed. Leaving the route also loses unsaved text.

Plan:

- Scope text, attachments, reply target, translation and AI request results to account, user and conversation.
- Reject stale asynchronous results after a switch. Preserve manually typed text when offering an AI replacement; provide an explicit replace/insert choice when needed.
- Add recoverable per-conversation text drafts and a visible draft indicator. Define device storage expiry and clear data on logout/account changes. Treat attachment persistence separately from text because staged files have cleanup rules.
- Stop or explicitly resolve recording when changing conversations.

Acceptance: type and attach in A, switch to B, and B stays clean; return to A and recover its draft. Delayed AI/translation/upload results cannot modify B. Reload and logout behavior is intentional and tested. Reproduce both desktop direct switching and mobile back navigation.

### 2. Make failed sends recoverable — P0, confirmed gap

Evidence: `message-composer.tsx:246` invokes a void-typed `onSend`, immediately clears text and resets sending state. `message-thread.tsx:777` creates optimistic messages and marks failures. The inspected message-action component supports reply, copy, reactions and translation, but no resend action. Failure feedback exists; recovery is incomplete.

Plan: introduce an explicit send-operation result and stable operation identity. Keep an editable failed message with Retry, Edit and Discard. Persist enough state to recover pending/failed operations safely. Distinguish definite rejection from unknown delivery after a timeout. Reconcile uncertain sends before offering a resend that could duplicate customer messages.

Acceptance: test offline, timeout after provider acceptance, HTTP rejection, double-click, reconnect, reload and attachment failure. Text remains recoverable and retry cannot silently send to a different conversation. Provider delivery/read states remain distinct from application acceptance.

### 3. Explain connection and loading failures persistently — P1, confirmed

Evidence: `src/hooks/use-realtime.ts` returns `isConnected`, but the inbox does not consume it. Existing WhatsApp configuration feedback is different from browser subscription health. Contacts loading errors at `src/app/(dashboard)/contacts/page.tsx:149` and `:171` show a toast without a persistent error state. No custom `error.tsx`, `global-error.tsx` or `not-found.tsx` was found under `src/app`.

Plan: add unobtrusive connection/reconnecting/stale indicators with last successful synchronization and retry. Define shared initial-loading, empty, no-results, partial-error, stale-data and forbidden states. Add route recovery boundaries and a useful missing-page destination. Preserve good existing states in the agenda and quotation list.

Acceptance: a failed contacts load cannot appear to mean “no contacts”; stale rows are labeled; errors offer a working retry; a failed panel does not unnecessarily blank the workspace. Never imply that browser connectivity proves WhatsApp delivery.

### 4. Organize navigation around daily work — P1, proposal grounded in current navigation

Evidence: `src/components/layout/sidebar.tsx:100` lists eleven primary modules, plus Settings. Automations and Flows have separate destinations. The header and sidebar both expose account controls. Sales Today already exists within the dashboard.

Plan: prototype three navigation groups: Work (Today, Inbox, Customers, Sales, Quotations), Growth (Broadcasts, Ad conversions), and Manage (AI, Automations/Flows, Settings). Keep existing route URLs. Explain the distinction between the two workflow builders before considering consolidation. Make advanced items discoverable without giving them equal emphasis in the salesperson's default view.

Prototype a phone navigation with Today, Inbox and More; retain direct job/quotation links from the conversation. Validate labels in Arabic and English. Treat “Sales” versus “Pipelines” and “Customers” versus “Contacts” as research questions.

Acceptance: sales staff can find an overdue customer, prepare a quote and record a worker report without coaching. Compare task time and wrong turns with the existing navigation before shipping.

### 5. Add saved work views and historical search — P1, confirmed scope limits

Evidence: `conversation-list.tsx:110` initializes search and filters in local component state. Migration `084_inbox_list.sql:20` searches contact name, phone and last-message text, not all message history. Existing triage views and server filters should be extended.

Plan: first retain filters/sort in the URL, then add named personal views and optional shared team views. Add explicit message-history search with conversation, sender and date filters, result snippets, and a jump to the matching message. Consider cross-module search for contact, job reference and quotation number after that.

Acceptance: refresh/back restores the queue; old messages outside the currently loaded history remain searchable; result counts cover the full authorized dataset; opening a result lands on the correct message. Saved views never retain access to records after permissions change.

### 6. Connect the customer-to-job journey — P1/P2, proposal

Evidence: sales workspace, quotations and group work already connect parts of this journey. `docs/group-work.md` records explicit manual posting, forwarded reports, accepted-quotation snapshots and a waiting-work queue. Worker identity, confirmed bookings and automatic group synchronization are not implemented by those features.

Plan: extend the existing sales workspace into a compact job overview: current stage, latest accepted quotation, measurement result, requested versus confirmed date, blocker, responsible salesperson and next action. Build a chronological view from existing records with links to source messages/documents. Keep multiple jobs for one customer explicit.

Add a verified appointment state only if staff need scheduling; a requested date must not become a confirmed appointment automatically. Preserve the current workshop acceptance gate and distinguish the person recording a forwarded report from its original author.

Acceptance: staff can answer “What are we waiting for, who follows up, and what was agreed?” from one place. Quotation changes cannot silently change already issued workshop instructions.

### 7. Finish phone and bilingual ergonomics — P1, requires visual/device validation

Evidence: the app has responsive layouts and prior phone-handoff fixtures. `src/app/inbox-workspace.css` also contains 10–11px labels and controls with small minimum heights. These are review targets, not proof of rendered accessibility failures. The dashboard shell contains hardcoded “Loading...”; send/upload errors include hardcoded English. No skip-to-content implementation was found in the inspected source.

Plan: validate 360/390px phones, a small laptop, browser zoom, Arabic mixed with Latin references, keyboard-only use and screen-reader announcements. Increase essential label readability; ensure finger-sized hit areas without making every desktop table sparse. Use a consistent form, inline-validation and status vocabulary. Add a skip link, focus restoration and translated recovery messages.

Acceptance: the phone keyboard never hides the active composer or primary action; errors are announced; long Arabic labels and numbers do not clip; all essential actions work without hover. Validate on real staff Android and iOS devices, beyond synthetic layout tests.

## Missing features worth validating

These are candidates, not a commitment to build everything.

| Candidate                                         | Why it may help                                                           | Existing foundation / boundary                                                                               | Priority |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Conversation collision warning                    | Reduce duplicate replies when two agents work the same chat               | Presence exists; add conversation-level viewing/composing indicators and explicit takeover behavior          | P1       |
| Follow-up escalation and notification preferences | Make overdue work visible without constant manual checking                | Extend Today, follow-ups and notifications; deduplicate alerts and support quiet periods                     | P1/P2    |
| Guided setup/readiness checklist                  | Help new admins connect the required pieces and understand failure states | Settings already has health/status information; distinguish configuration from verified successful operation | P2       |
| Review-and-merge contacts                         | Resolve genuine duplicate identities without losing history               | Phone deduplication already exists; merging must preview affected chats/deals and resolve conflicting fields | P2       |
| Recoverable quotation drafts                      | Reduce loss during long edits and interruptions                           | Unsaved-change guards and revision/document history already exist; add recovery with conflict handling       | P2       |
| Operational reporting                             | Reveal waiting time, quote turnaround and blocked-work age                | Extend existing dashboard/conversion reporting with documented metric definitions and actionable drill-downs | P2       |
| Customer quotation approval link                  | Reduce ambiguous acceptance and repeated document sharing                 | Validate demand and identity/evidence requirements before designing an external approval flow                | Later    |
| Mobile push/share-in and limited offline capture  | Support work away from the desktop                                        | Prototype with staff devices; offline capture must remain clearly unsent until confirmed                     | Later    |

Do not start a native worker app, inventory/accounting suite, generalized AI autonomy, or another automation builder as part of this plan. Their need and workflow ownership are not established by this review.

## Engineering approach

Keep the existing stack and permission model. Refactor only along the workflows being improved: the thread is 1,785 lines, composer 1,069 and quotation workspace 1,300 in the reviewed tree. Extract draft/send-operation state and async coordination into testable modules; avoid a broad rewrite.

Add privacy-conscious diagnostics for route readiness, save/send failures and queue recovery. Log operation identifiers and timings, not customer message content. Define account timezone semantics for business deadlines explicitly; Today currently uses device-local midnight, which may be intentional but should be agreed for staff working across timezones.

Use `docs/performance-execution.md` as the local performance baseline. Do not repeat already implemented pagination/aggregation work or claim its synthetic timings are production results. Verify deployment/migration status separately and measure the pilot on representative devices.

## Delivery plan

Estimates are engineering working days for one developer with design/QA support, excluding deployment approvals and discovery-driven scope changes. Re-estimate after the first tranche.

| Tranche | Work                                                                                                       | Estimate  | Exit condition                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| 0       | Reproduce draft/send issues; observe 3–5 staff across real inquiry-to-job journeys; capture baseline tasks | 2–3 days  | Confirmed failure cases, task map and agreed measures                                 |
| 1       | Conversation isolation, stale async guards, draft recovery and safe failed-send handling                   | 5–8 days  | Failure/switch/reload tests pass; no cross-customer draft contamination               |
| 2       | Persistent errors, connection feedback, route recovery, critical phone/Arabic fixes                        | 4–6 days  | Complete recovery paths and device/keyboard walkthrough                               |
| 3       | Saved views, navigation prototype/pilot and historical message search                                      | 6–10 days | Find/resume tasks improve; search respects permissions and paging                     |
| 4       | Unified job overview and the highest-value validated missing feature                                       | 5–8 days  | Pilot staff complete the end-to-end workflow with less copying and fewer missed steps |

Draft storage precedes recovery UX; operation identity/reconciliation precedes resend; source-of-truth mapping precedes the unified timeline. Appointment/worker identity design precedes scheduling or worker-directed notifications. Design prototypes can be evaluated while reliability implementation proceeds.

Suggested pilot measures: zero cross-conversation draft contamination; 100% recovery in the defined network-failure test matrix; at least 90% unassisted success on agreed core tasks; target 25% faster resume-and-follow-up task completion against the observed baseline. Track overdue follow-ups, duplicate replies and quotation turnaround over a longer pilot rather than promising immediate business gains.

For each tranche run focused unit/integration tests, TypeScript and applicable production build checks. Add browser journeys for chat switching during requests, send timeout/retry, stale data, multiple tabs, permissions changes and English/Arabic mobile layouts. Use synthetic customers for automated tests and validate real-device ergonomics with staff. Preserve all existing uncommitted work.

## Recommended first commitment

Commit to tranches 0–2 first. They address preventable mistakes and lost work while providing the evidence needed to choose the next feature. Then prioritize saved views/search and the connected job overview based on observed staff friction.
