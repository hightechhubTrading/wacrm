# Performance implementation — 30 October 2026

Implements [the performance plan](performance-plan-2026-10-30.md), against source baseline `91c1bb5`. **Deployed to production at `1b0b4f9caef5418a746096634b3a29999838306d`. Migrations 083–086 are applied.** Migrations precede the application; missing RPCs surface errors rather than reverting to unbounded downloads.

## Changes

| Area            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calling         | Healthy idle reconciliation every 30 seconds; 4-second fallback when disconnected or calls are active. Confirmed-disabled idle calls skip call-list reads. Settings reconcile every 30 seconds, simultaneous triggers coalesce, settings survive transient errors, and reads time out after 10 seconds. Incoming realtime listeners remain active in hidden tabs.                                                                           |
| Inbox           | `inbox_list` returns 50-row keyset pages with global search, filters, triage/sales ordering, full-result counts and company facets. Explicit card fields replace complete-row downloads. Ordinary inbox rows render before separate sales-count aggregation. Search and invalidation bursts debounce 250 ms; initial/filter/page reads start immediately. Deep links fetch the individual authorized conversation outside the current page. |
| Realtime/unread | Loaded previews update immediately; unseen changes coalesce bounded-list invalidation. Reconnect callbacks reconcile history/list state. Sidebar uses exact count-only snapshots and O(1) updates for known events, with batched unknown-event reconciliation, bounded memory, snapshot-race protection and periodic/focus/reconnect recovery.                                                                                              |
| Dashboard       | Four SECURITY INVOKER SQL aggregations return metrics, message buckets, stage totals and response-time summaries without downloading raw rows. Browser-local calendar boundaries and timezone are preserved.                                                                                                                                                                                                                                |
| Pipelines       | Server-side global filters/search/facets/counts; Board returns six cards per stage, List 25, Tags six. Full editor details load on demand. Complete CSV export explicitly retrieves 100-row pages and rejects inconsistent/incomplete results. Sorting has ID tie-breakers and server-clamped page positions. Explicit inaccessible conversation links never borrow another recap.                                                          |
| Quotations      | API defaults to 50 and caps at 100 rows, preserving array responses with `X-Total-Count`. List/dialog use 25-row pages, literal server search, cancellation and debounce. Inbox sales panel requests one latest quotation.                                                                                                                                                                                                                  |
| Startup         | Settings panels load on demand with stable placeholders. Shared and route translation catalogs replace the full root catalog. Sidebar prefetch starts on sustained hover or keyboard focus.                                                                                                                                                                                                                                                 |
| Authentication  | `account_profile()` combines own profile and readable account metadata in one authenticated RPC, independent of PostgREST FK cache. Server still validates the user freshly before reading context. Client rejects stale profile/session responses after account switches, logout and unmount. No authorization cache crosses requests.                                                                                                     |
| Diagnostics     | `PERFORMANCE_LOGS=1` enables durations for account resolution and Supabase operations. Logs omit identities, query strings, bodies and credentials. Off by default.                                                                                                                                                                                                                                                                         |

Existing conversation virtualization, history pagination, thread caches, read receipts and message anchoring remain in use. Measured long-thread behavior determines whether message virtualization is warranted; no speculative replacement was added.

## Database and infrastructure evidence

[Sanitized query plans](performance-query-plans.json) execute the exact prepared SQL bodies in **read-only transactions**, as an authenticated user with table RLS. They do not install functions. Representative live account data: 639 contacts/conversations, 638 deals, 6,067 messages and seven quotations. A single warm-cache sample is diagnostic evidence, not an API latency percentile.

| Operation                 | Execution time |
| ------------------------- | -------------: |
| Inbox ordinary first page |        73.2 ms |
| Inbox sales metadata      |       213.6 ms |
| Pipeline                  |       181.3 ms |
| Dashboard metrics         |        94.3 ms |
| Message series            |        71.1 ms |
| Response times            |        42.0 ms |
| Own profile/account       |         1.1 ms |

The initial pipeline SQL draft repeatedly scanned visible profiles (638 loops, approximately 543 ms). Materializing authorized working sets and joining once reduced measured execution to approximately 136–181 ms across subsequent samples. Expensive sales counts are separate from ordinary inbox first paint. Existing migration 071 already supplies the message-history composite index. No speculative duplicate indexes were added.

[Hostinger metrics](performance-infrastructure.json) cover the entire shared 2-vCPU/8-GiB VPS over 24 hours, with 48 samples. CPU averaged 13.1%, p95 24.7%, peak 40.8%; memory averaged approximately 3.0 GB and peaked at 4.9 GB. These samples do not establish sustained saturation and can miss brief spikes. Application changes take priority over a server upgrade.

## Verification

- Vitest: **1,526 passed, 68 skipped**, 180 passing files plus three skipped. Skipped live suites are not treated as verified.
- TypeScript and production webpack build: passed for the final application source.
- Disposable SQL fixtures for dashboard, inbox, pipeline and account profile check >1,000-row correctness, stable paging/sorting, full-result search/facets/counts, export coverage, timezone boundaries, response pairing, tenant/assignment isolation, hidden account metadata and anonymous denial.
- Production React component browser fixtures check calling cadence/hidden-tab notifications, reconnect reconciliation, quotations, English/Arabic scopes, inbox/pipeline paging/search/moves/CSV and out-of-order session/profile/logout responses.
- Full production Next workspace profiling uses actual routing, auth lifecycle, SDK subscriptions and API handlers with a local synthetic Supabase transport. It is separate from the SQL/RLS fixtures and does not emulate production authorization. It blocks external/customer requests and uses synthetic WebRTC signaling; real customer audio is not exercised.

Final exact-tree checks passed: TypeScript, production webpack build, all 1,526 unit tests, all four disposable SQL fixtures, component browser checks and `git diff --check`. Focused ESLint has zero errors and one existing remote-avatar `<img>` warning in `conversation-list.tsx`. The profiled build's source/message SHA-256 matches the released source at `1b0b4f9` (verified from its Git archive, independently of later workspace changes).

## Production-build comparison

[Summary and limitations](performance-comparison.json), [original build trace](performance-browser-baseline.json), [optimized build trace](performance-browser-current.json). Both runs completed with no browser errors. These are local authenticated production builds using the same synthetic transport, **not live-user benchmarks**.

Times below are milliseconds to useful content. Each route has one cold observation and four to six warm observations. The reported sample p95 is near the observed maximum; this sample is too small to estimate a population tail reliably.

| Route      | Cold before → after | Warm p50 before → after | Warm sample p95 before → after |
| ---------- | ------------------: | ----------------------: | -----------------------------: |
| Inbox      |         1,505 → 953 |               839 → 254 |                      848 → 902 |
| Dashboard  |         1,921 → 787 |             1,370 → 273 |                    1,380 → 385 |
| Pipelines  |       3,439 → 1,032 |             2,838 → 827 |                    2,914 → 879 |
| Quotations |         1,278 → 690 |               838 → 315 |                      859 → 820 |
| Settings   |           640 → 485 |               134 → 116 |                      137 → 125 |

Inbox median and cold behavior improved, but these samples **do not establish an inbox tail-latency improvement**. The first warm navigation remained about 900 ms. Repeat representative uncached/client-navigation traces after rollout before setting its final p95 budget; do not infer a uniform percentage speedup from the other routes.

| Traffic/resource check                           |         Before |          After |
| ------------------------------------------------ | -------------: | -------------: |
| Five-minute idle call-list reads                 |             75 |             10 |
| Five-minute idle settings reads                  |             10 |             10 |
| Five-minute total backend requests               |            525 |            155 |
| Two tabs, 60 seconds: call-list + settings reads |             34 |              8 |
| Two tabs, 60 seconds: total backend requests     |            202 |             60 |
| Cold settings encoded script bytes               |        413,464 |        314,121 |
| Server account-resolution p50 / p95              | 82.6 / 86.7 ms | 56.0 / 66.7 ms |

Healthy-idle calling requests fell **76.5%** in both single- and two-tab measurements, exceeding the 70% target. Total idle backend requests fell approximately 70%. Other routes' script bytes increased slightly (approximately 0.6–1.3%) as bounded-query coordination replaced bulk reads. The settings script reduction is approximately 24%; this does not imply every route ships less JavaScript.

Cold backend response windows fell from roughly 3.8–5.9 MB to 56–84 KB for inbox/dashboard/pipelines. These windows include concurrent background work/prefetch, so they are not isolated list-query transfer measurements. Browser collection stops 100 ms after useful content; later transfers can occur.

Cached chat switching remained comparable (178 → 175 ms). Typing through eight incoming SDK events took 128 → 99 ms. With 559 messages loaded, sampled scroll-frame p95 was 19.2 → 18.6 ms, maximum observed EventTiming duration was 72 → 80 ms, and maximum long task was 126 → 124 ms. The event observer excludes very short events; these are **not field INP**. This evidence supports preserving existing message rendering and anchoring rather than adding variable-height virtualization now. Profile again for substantially longer loaded histories or slower devices.

Local Next process peak sampled RSS was about 340 → 324 MB; loaded-workspace browser heap about 90 → 88 MB. These samples do not establish leak behavior or production container capacity. Resource sampling uses local `ps`; its CPU percentages are process-lifetime averages.

Full-workspace checks passed for deep links beyond page one, cached switching, persisted contact-panel preference, typing under realtime bursts, missed-message recovery after a real SDK reconnect, unread snapshot/event transitions, all thirteen settings deep links, scoped Next navigation, mobile Arabic and synthetic incoming/outgoing signaling with hidden-tab ringing, mute and peer cleanup. Real audio/customer calls were not made. Earlier short-debug and fake-clock idle output is superseded by these real elapsed-time runs.

## Mobile route comparison

The same two production builds were measured at **390 × 844**, with the same 4× CPU slowdown, network profile and fixture. [Baseline trace](performance-mobile-baseline.json), [optimized trace](performance-mobile-current.json). Both completed without browser errors. Each route has one cold and four warm observations; warm navigation uses the real mobile drawer. Repeated selections of the already-current route are omitted. These route-only runs do not repeat idle/calling regression tests, which are covered by the full reports above.

| Route      | Cold before → after | Warm p50 before → after | Warm sample p95 before → after |
| ---------- | ------------------: | ----------------------: | -----------------------------: |
| Inbox      |         1,564 → 982 |             1,030 → 465 |                  1,056 → 1,045 |
| Dashboard  |         1,945 → 757 |             1,614 → 499 |                    1,626 → 617 |
| Pipelines  |       3,402 → 1,325 |             3,059 → 642 |                  3,091 → 1,051 |
| Quotations |         1,259 → 702 |             1,058 → 548 |                    1,084 → 567 |
| Settings   |           535 → 462 |               453 → 332 |                      478 → 345 |

The mobile samples reinforce the median improvements without establishing a meaningful inbox tail improvement. Repeat inbox tail measurements with normal staff navigation after release.

## Reproduction

```sh
npm test
npm run typecheck
PLAYWRIGHT_CHANNEL=chrome node scripts/check-performance-browser.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/profile-performance.mjs
PERFORMANCE_VARIANT=baseline PLAYWRIGHT_CHANNEL=chrome node scripts/profile-performance.mjs
```

The profiler archives pinned baseline `91c1bb52a17ec036242bef64eb3e9b9345617154` (override with `PERFORMANCE_BASELINE_REF`), overlays the working source for current comparisons, and records a source SHA-256. Committing the optimizations does not move the baseline. Both builds use webpack, as the Dockerfile does, with the same 1,500-record fixture, Chrome, 4× CPU slowdown, 40-ms network latency and 25-ms synthetic backend latency. Cold means full document navigation after clearing HTTP cache; warm means actual Next client navigation. Five-minute idle uses real elapsed time. `PERFORMANCE_IDLE_MS=0` is debug-only and explicitly fails the five-minute requirement. Use `PERFORMANCE_VIEWPORT=mobile PERFORMANCE_ROUTES_ONLY=1` for the mobile route profile and set `PERFORMANCE_REPORT` to a distinct output file. Build-only and reused-build options are documented in the profiler source; source snapshots reside in temporary directories.

Disposable SQL commands require a temporary PGlite installation; set `PGLITE_MODULE` to its `dist/index.js`, then run each `scripts/check-*-db.mjs` file listed above. Current local installation: `/tmp/wacrm-sales-today-db/node_modules/@electric-sql/pglite/dist/index.js`. SQL fixtures never use production credentials. `node scripts/explain-performance.mjs` requires the linked Supabase CLI and performs read-only plan inspection.

## Rollout

`deploy/check-database.mjs` now checks all seven new RPC signatures before startup/promotion using identity-free, read-only requests. It accepts deliberate service-role EXECUTE denial after resolution without widening grants. Sixteen deployment tests cover missing functions, malformed/unsafe empty-scope responses and denied execution. See [VPS deployment instructions](../deploy/README.md#performance-release-database-prerequisites). Synthetic benchmark builds must never be promoted: rebuild the reviewed source using the existing production configuration.

1. Review and apply migrations `083_dashboard_aggregates.sql`, `084_inbox_list.sql`, `085_pipeline_list.sql`, `086_account_profile.sql` in order through the established timestamped linked migration process. Do not push the numeric migration directory wholesale. Confirm authenticated EXECUTE grants and RLS behavior; refresh PostgREST schema cache and smoke-test all RPC signatures.
2. Deploy the verified application build. New SQL functions are additive and do not change table schemas, triggers or existing functions; an older application can remain deployed while migrations are installed.
3. Check authenticated inbox/deep links, filters/counts, moves/exports, every settings section, both locales, unread/reconnect recovery and incoming/outgoing call setup. Use a staff pilot for physical-device/audio checks.
4. Compare real-user route/API timings and error rates against the pre-release baseline. Temporarily enable duration logs only if needed. Revert the application image on regression; keep additive RPCs until no clients use them. Do not remove functions while a new client is active.

Production-user latency and physical-device audio need staff follow-up; tenant reassignment is exercised in isolated fixtures rather than changing staff access. Post-deploy smoke checks are recorded below. Synthetic measurements and read-only live query plans do not prove real-device audio or population latency outcomes.

## Authorized rollout — 30 October 2026

The user instructed continuation of the pending migration/deployment sequence.
Migrations were applied atomically through the timestamped linked-database process:

| Source migration         | Recorded version |
| ------------------------ | ---------------- |
| 083 dashboard aggregates | 20261030071715   |
| 084 inbox list           | 20261030071716   |
| 085 pipeline list        | 20261030071717   |
| 086 account profile      | 20261030071718   |

Live authenticated read-only validation passed for all seven RPCs: caller-RLS/anonymous privileges, own account binding, dashboard counts against scoped tables, series/summary shapes, bounded inbox/pipeline pages and cross-tenant empty results. The service-environment startup preflight passed after schema reload. The ordinary suite was rerun (1,526 passed, 68 skipped), as were TypeScript and sixteen deployment-guard tests. Before rollout, production was at baseline `91c1bb52a17ec036242bef64eb3e9b9345617154`. The installed updater matches the reviewed repository copy; its active-call check, candidate validation and automatic rollback remain in place.

Private SQL/output/deployment evidence resides at `~/.local/state/wacrm/releases/performance-20261030/`. The updater successfully promoted `1b0b4f9caef5418a746096634b3a29999838306d`. The running image is `sha256:dfc449daa4a2dd000d100d470d470339e2b50c0af8b2c0ed0d3cb92af47c94be`, build ID `CT05EuwRoRYO_UEWhHctS`. Its source/message SHA-256 matches both production-build profiles. The verified rollback image is retained as `wacrm:rollback` at baseline revision `91c1bb52a17ec036242bef64eb3e9b9345617154`.

Post-promotion checks passed:

- Running revision/image match; database startup preflight passes with the actual server environment.
- Internal login returns 200; unauthenticated dashboard/inbox return 307; quotations/calling/audio-config APIs return 401.
- Public HTTPS login renders its email form with no browser errors; protected public inbox redirects to login.
- All seven new RPC endpoints deny anonymous execution with PostgreSQL permission code 42501. Authenticated shapes/counts/tenant boundaries were checked separately in the live database.
- The exact temporary SSH key was removed, and Hostinger reports no remaining root deployment keys.

No real customer messages or calls were sent. Real-user tail latency and physical-device audio remain monitoring/staff checks, as described above. Later workspace feature edits are outside this deployed source revision.
