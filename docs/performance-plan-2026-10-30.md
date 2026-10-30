# App speed optimization plan — 2026-10-30

Implementation and verification progress is tracked in [performance-execution.md](performance-execution.md). The source review below records the original baseline; its statement about unchanged behavior applies to that review.

Source reviewed at commit `91c1bb5`. This is a source-based plan, not a production benchmark. No application behavior was changed. Production browser traces, deployed database query plans, bundle sizes, and server resource utilization remain to be measured. Effort estimates below are engineering estimates, not promised speedups.

## What is already working

The earlier `docs/performance-audit.md` records improvements that are present in the current source: virtualized conversation rows, 50-message history pages, bounded thread previews and intent prefetch, incremental sales-context requests, stable calling snapshots, and paged pipeline List rendering. Contacts already has database pagination. Opus recording and the catalog Excel import already use dynamic imports. Preserve these improvements; repeating them will not address the remaining load.

## Prioritized work

### 1. Reduce global calling traffic — high priority, 1–2 days

Evidence: `src/app/(dashboard)/dashboard-shell.tsx` mounts `CallingProvider` on every dashboard route. In `src/components/calling/calling-provider.tsx:149`, eligible users get call-list polling every 4 seconds and settings polling every 30 seconds, alongside realtime. Neither timer is gated by the enabled setting or page visibility. That is 17 scheduled requests per minute per eligible tab, excluding initial loads, focus events and realtime-triggered refreshes. Stable snapshots already avoid unnecessary context changes but do not remove these requests.

Plan:

- Keep global incoming-call detection. Track realtime health and use a slower reconciliation poll while healthy and idle; retain fast fallback after disconnect and during call setup/active calls.
- Stop call-list polling when calling is confirmed disabled, while retaining a reliable settings-change detection path.
- Coalesce simultaneous refresh triggers and allow only one in-flight reconciliation, scheduling another if necessary.
- Consider one polling leader per browser account across tabs only after the simpler change is measured.

Acceptance: target at least 70% fewer idle calling requests with healthy realtime. Test incoming calls in hidden tabs, disabled-to-enabled transitions, reconnects, outbound SDP exchange, active-call cleanup and multiple tabs. Do not simply pause hidden-tab calling.

### 2. Bound inbox data loading — high priority, 3–5 days

Evidence: `src/components/inbox/conversation-list.tsx:180` fetches conversations without a limit using `CONVERSATION_SELECT`, which includes complete conversation/contact/tag rows (`src/lib/inbox/conversations.ts:10`). Filtering and counts operate on the returned client dataset. Virtualization limits rendered rows, not downloaded records. `src/hooks/use-sales-context.ts:96` still refreshes context for all loaded conversations every 30 seconds when visible, in batches of 500. Sidebar `src/hooks/use-total-unread.ts` independently loads every visible conversation's ID/count and scans its map on every event.

Plan:

- Introduce an account/permission-scoped list query with a small initial page, explicit list fields and a stable cursor including ID and last-message timestamp. Define null-timestamp ordering.
- Move search, filters, triage ordering and full-result counts server-side together. Paginating first while retaining client-only filters would hide matching conversations.
- Fetch sales detail for visible/nearby rows; calculate any sales fields needed for global ranking/filtering in the server query, so unseen conversations remain discoverable.
- Share context data between the list and selected conversation. Use mutation invalidation and slower reconciliation instead of repeatedly refreshing every loaded ID.
- Replace the unread map scan with reliable incremental updates and reconcile snapshots on reconnect. If only a dot is needed, evaluate an existence query; preserve any numeric badge semantics.

Acceptance: initial payload is bounded as account size grows; search and counts find records beyond the first page and database API row cap. Test tied/null timestamps, event-driven reordering, deletion, reconnect and events arriving during the initial snapshot. Preserve warm thread switching and RTL behavior.

### 3. Aggregate dashboard metrics in the database — high priority, 2–3 days

Evidence: `src/lib/dashboard/queries.ts:110` downloads individual message rows for series; `:175` downloads 14 days of messages to calculate response times in JavaScript. Deal totals and stage summaries also fetch rows for client aggregation. Without explicit pagination these can hit the database API row cap, affecting accuracy as well as speed. Independent widgets already start in parallel; another `Promise.all` is not the solution.

Plan:

- Replace raw-row analytics with permission-scoped SQL functions returning daily buckets, totals and response-time summaries. Preserve the existing response-pairing definition and date boundaries.
- Use query plans on representative data to choose indexes; verify deployed migrations first. Migration 071 already adds `(conversation_id, created_at DESC, id DESC)` for message history, so do not duplicate it.
- Introduce a short-lived cache only if aggregation still needs it; key by account, authorization scope, range and timezone. Do not publicly cache authenticated dashboard responses.

Acceptance: bounded response size for 7/30/90-day views; results match fixtures exceeding the configured API row cap. Cover timezone boundaries, unanswered messages, multiple inbound messages and permissions.

### 4. Page pipelines and quotations at the data layer — high priority, 3–5 days

Evidence: `src/app/(dashboard)/pipelines/page.tsx:202` sequentially downloads all deals in batches of 500, including full contacts, custom values and assignees, then loads summaries. Render limits do not reduce this work. `src/app/api/quotations/route.ts` has an unpaginated list query; `src/components/quotations/quotation-list.tsx` filters and renders the returned list.

Plan:

- Use a compact deal-card projection and defer editor-only fields to opening a deal.
- Add server-side filtering and paging for pipeline List and per-stage incremental loading for Board; return full-result totals separately. Preserve Tags-view semantics.
- Add bounded quotation pages, server search and counts. Audit deal-specific quotation callers before changing the response contract.
- Keep export explicitly capable of retrieving all matching records rather than exporting only the loaded page.

Acceptance: first usable view requires bounded data, even with thousands of deals/quotations. Verify drag/drop across partially loaded stages, global search, totals, exports and edits.

### 5. Reduce startup JavaScript and translation payload — medium priority, 1–2 days

Evidence: `src/app/(dashboard)/settings/page.tsx` statically imports all settings panels. Only the selected panel mounts, but the imports lack on-demand boundaries. `src/app/layout.tsx` passes the complete active locale catalog to the root client provider. Source JSON sizes are about 133 KB English and 177 KB Arabic, before minification/compression; these are not measured transfer sizes.

Plan:

- Measure production chunks first, then dynamically import heavy settings panels and dialogs, rendering them only when selected/opened. Give each a stable loading placeholder.
- Separate shared-shell translations from route-specific messages if serialized payload measurements justify it. Preserve every namespace consumed by shared components and errors.
- Profile charts and flow-editor dependencies within their own routes; do not infer they ship globally merely because they are installed.

Acceptance: unopened heavy panels are absent from the initial route download; record compressed JavaScript and hydration time before/after. Verify every settings tab, deep link and both locales. Follow the installed Next 16 lazy-loading guide and [official Next.js documentation](https://nextjs.org/docs/app/guides/lazy-loading).

### 6. Profile authentication and long-thread rendering — medium priority, measurement first

Evidence: `src/middleware.ts` calls `auth.getUser()` under a broad matcher. Calling routes also resolve role/account context. `src/hooks/use-auth.tsx` loads profile then account before publishing profile state. These are potential round trips to measure, not proof that auth dominates latency. `src/components/inbox/message-thread.tsx:1547` renders all loaded message groups: history is paginated, but mounted rows grow as older pages are loaded.

Plan: add timing around auth, account resolution and queries; remove duplicate work only within the same authenticated request or safe session lifecycle. Preserve server authorization and token refresh. Profile long threads before adding variable-height message virtualization; preserve scroll anchoring, quoted-message jumps, media resizing and keyboard access.

Acceptance: no auth/session regression; fewer measured round trips where duplication is confirmed. Long-thread scrolling and typing remain responsive at representative history sizes.

## Execution and measurement

1. **Baseline, 0.5–1 day.** Use an authenticated production build with representative data. Capture cold/warm inbox, dashboard, pipelines, quotations and settings loads; a five-minute idle period; chat switching; typing while messages arrive; and long-thread scrolling. Repeat on a modest laptop and mobile viewport with a consistent CPU/network profile. Record useful-content time, p50/p95 interactions/API latency, request count, transferred bytes, long tasks, heap and server CPU/RAM. Test one and several tabs. Login-page Lighthouse scores alone do not describe this app.
2. **First batch.** Calling traffic reduction and measured settings splitting, then dashboard aggregation. These have relatively clear boundaries and directly reduce recurring/server/startup work.
3. **Second batch.** Inbox query redesign, then pipeline and quotation pagination. Consult the repository's linked architecture/working notes before these substantial data-flow changes. Add indexes only after inspecting plans with representative data and RLS enabled.
4. **Final batch.** Auth waterfall and long-thread work where traces justify it. Inspect VPS resource contention and application/database region latency before considering infrastructure upgrades. The deployment documentation describes a shared VPS and resource-limited builds; live saturation has not been established.

Provisional targets: p75 interaction latency under 200 ms, at least 70% fewer healthy-idle calling requests, bounded initial list payloads, and materially lower p95 useful-content time on the same fixtures. Set route-specific latency budgets from the baseline; no percentage speedup is established by this review.

Ship each batch independently. Run focused correctness tests plus typecheck/lint and a production build, compare the same browser traces, and check permissions/reconnect behavior before rollout. Preserve current thread caching and realtime safeguards. Avoid blanket public caching, increasing database row caps instead of paging, or adding memoization everywhere without profiler evidence.
