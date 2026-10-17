# App performance audit — 2026-10-17

Scope: source review of the dashboard shell, inbox, pipelines, quotations,
contacts, broadcasts, dashboard queries, presence, calling, and polling hooks.
Browser checks used synthetic records and mocked requests on the local Next
**development** server. These are request/render-count measurements, not
production latency or frame-rate benchmarks.

## Confirmed and addressed

| Cause | Change | Evidence |
| --- | --- | --- |
| Every conversation timestamp change restarted sales-context loading for the entire inbox and cleared the displayed context while waiting. | Retain account/user-scoped context, request changed conversation IDs, coalesce bursts for 250 ms, cancel superseded requests, keep context after transient errors. | With 510 conversations, initial batches contain 500 + 10 IDs; one new message requests just 1 ID. Four quick updates produce one request. Existing 510 contexts remain available during a slow request and after an error. |
| Sales-context polling and mutation refreshes continued in hidden tabs. | Skip hidden-tab requests and refresh on becoming visible. Mutation events and periodic refreshes still refresh the full dataset for cross-conversation work changes. | Hidden mutation event makes no request; becoming visible reloads both batches. |
| Each new message refreshed contact deals, notes, and tags immediately. | Coalesce message-triggered refreshes for 350 ms. Selecting another contact still loads immediately; all three resources remain included because automation may update them. | Four quick updates produce three resource reads in total. |
| Pipeline List rendered all deals despite the Board and Tags views already limiting mounted cards. | Page List view in groups of 25; retain full-data search, counts and export. | A 510-deal fixture mounts 25 rows; next-page navigation changes the displayed records. |
| Global calling polls created a new call array every four seconds, even when empty or unchanged. Calling context also changed during the call duration clock. | Retain identical call snapshots and memoize the exposed context. Keep polling cadence and call detection intact. | Three idle polls continue running without changing consumer context. Unit checks cover incoming/removed calls, state changes, assignment and SDP changes. |
| Chat image cleanup captured an empty initial `src`, retaining fetched blob URLs after unmount or URL changes. Audio and video did not specify a preload policy. | Track and release the URL created by each image request, cancel unfinished requests, and use `preload="none"` for audio/video. | Browser check creates two image URLs, changes/unmounts the image and confirms both are released; audio/video produce zero requests before playback. |
| The idle message thread and its welcome Agenda both subscribed to member presence. | Enable the thread's subscription only while a conversation is selected; Agenda retains its own subscription. | Source lifecycle check; existing presence subscription tests pass. |

Relevant implementation:

- `src/hooks/use-sales-context.ts`
- `src/components/inbox/contact-sidebar.tsx`
- `src/components/inbox/message-thread.tsx`
- `src/components/inbox/message-bubble.tsx`
- `src/components/pipelines/pipeline-explorer.tsx`
- `src/components/calling/calling-provider.tsx`
- `src/lib/whatsapp/calling/snapshots.ts`

## Remaining priorities

These patterns are confirmed in source; their production timing has not been
measured. They remain unchanged in this pass.

| Priority | Finding | Suggested next work |
| --- | --- | --- |
| High | `src/lib/dashboard/queries.ts`: conversation-series and response-time widgets fetch individual message records and aggregate them in the browser. Response time covers 14 days; the series can cover 90 days. Queries have no explicit pagination, so database API row limits may also truncate results at larger volumes. | Return daily buckets and response-time aggregates from account-scoped SQL functions. Check timezone behavior, RLS, indexes and query plans against representative datasets before replacing the existing queries. |
| High | `src/app/api/quotations/route.ts` selects complete quotation rows without pagination; `src/components/quotations/quotation-list.tsx` searches and renders all returned quotations. | Add server search, bounded pages and a total count for the main quotation list. Preserve deal-specific callers and existing API consumers. |
| Medium | Pipeline initial loading still fetches every deal, joined contact data, and saved conversation/summary context. Rendering limits reduce DOM work but do not reduce this initial payload. | Measure payload sizes and query timing. Fetch board/list fields explicitly; defer detailed custom fields and editor-only data until requested. Keep cross-page search, counts and export correct. |
| Medium | Calling still makes 15 call-list requests and 2 settings requests per minute per eligible open tab, in addition to realtime. | Measure server cost. Consider a slower fallback when realtime is healthy, with immediate fallback on disconnect and fast synchronization during active calls. Do not pause incoming-call detection merely because a tab is hidden. |
| Medium | The sidebar unread indicator reads every visible conversation's ID/unread count on initial mount and scans its local map for every conversation event (`src/hooks/use-total-unread.ts`). | Use a count snapshot and reliable incremental updates, with reconnect reconciliation. Test events arriving during the initial snapshot before changing this lifecycle. |
| Medium | The desktop contact panel is hidden with CSS on mobile but remains mounted (`src/app/(dashboard)/inbox/page.tsx`). Opening the mobile panel can introduce a second data reader for the same customer. | Mount only the panel appropriate to the viewport, or share its loaded data; verify responsive transitions and preserved drafts. |

Contacts already uses database pagination; notification and automation-log
screens have explicit limits. Those are not the same unbounded-rendering case
as the former pipeline board.

## Validation

- Browser fixture: 510 conversations/deals; incremental requests, burst
  coalescing, retained state on errors, hidden/resume behavior, List paging,
  and unchanged call context during idle polls.
- Existing inbox regression fixture: virtual list, message-history paging,
  retries, reply quotes, reconnect catch-up, conversation switching, mobile RTL.
- Browser media check: image URL changes/unmounts release allocated blobs; audio/video remain unloaded before playback.
- Focused unit tests, changed-file ESLint, and TypeScript checks.
- Temporary review routes and the temporary auth-context export are removed.

## Follow-up: chat opening and switching

A focused browser check on the development server added a 450 ms delay to
recent-message responses. Before this change, reopening a visited chat still
cleared the transcript and displayed a loader; the measured switch took about
930 ms. Repeated checks after the changes took roughly 140–210 ms without a
loader. These are synthetic development measurements, not production SLAs.

- Keep at most ten recent thread previews, with at most fifty messages each,
  for two minutes. The cache belongs to the mounted account/user workspace;
  changing either remounts the inbox. Nothing is persisted to browser storage.
- Display a preview immediately and refresh in the background. Recent-message
  catch-up still fills missed pages, including after a disconnected period.
- Start a single speculative fetch after 150 ms of pointer/focus intent.
  Reuse its response when opening that chat; bound retained prefetches to three.
- Distinguish loading from a confirmed empty chat on the first render.
- Paint messages before mounting the desktop contact data panel. Do not mount
  that desktop reader on mobile; keep its desktop space reserved during loading.
- Mount per-message reaction and translation popovers only on hover, focus or
  long-press. Previously fifty messages created one hundred hidden popover roots.
- Reset the reply draft when switching conversations.

Browser checks cover warm switching without a loader, reuse of intent prefetch,
message requests completing before contact-panel reads, reaction/reply actions,
load failure/retry, workspace isolation, reply-draft isolation, older-history
paging, quoted parents, reconnect catch-up, stale history responses and mobile
Arabic. Unit checks cover preview bounds, eviction and expiry.
