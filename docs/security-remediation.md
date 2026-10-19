# Security remediation — 2026-10-17

Local patches address the 13 source-grounded audit records independently reviewed
against commit `ab046e9d009c45f74eae7585dd53cd8b5b127e32`. This is a source review,
not a demonstrated exploit or a verified deployment. All records retain
`needs_validation`; no severity has been assigned. The broader audit also retains
the source-drift coverage gap recorded in its external report.

## Changes

| Audit record | Local control |
| --- | --- |
| Stale AI notification recipient | Recheck current membership in both AI producers; notification insert guard and read/update RLS; clear saved assignments on account departure. |
| Automation conversation context | Resolve supplied IDs using account and contact; check the same relationship before every automation/flow provider send and scope preview writes. |
| Won conversion assignment | Caller-authenticated RPC checks membership, conversation and linked-deal assignment under locks, then updates/enqueues in one transaction. All conversion stages use this RPC. |
| AI slot RPC exposure | Revoke PUBLIC/anon/authenticated execution; grant service role only. |
| Auto-lead foreign contact | Validate conversation/contact tenancy before privileged triggers and scope trigger lookups. |
| Won-trigger foreign conversation | Validate deal relationship tenancy, including status changes, and scope trigger fallback/lookups. |
| Webhook failure RPC exposure | Revoke PUBLIC/anon/authenticated execution; grant service role only. |
| Media proxy assignment | Require a matching message visible under caller RLS before accessing the token/provider; private, no-store response. |
| Membership RPC stale authorization | Lock caller and target profiles in stable UUID order before authorization and mutation. |
| PDF document injection | Validate saved export data, encode drawing days, disable page JavaScript/service workers and abort browser requests; reject invalid direct JSON writes in SQL. |
| Viewer Storage mutation | Chat/flow writes require agent+; AI media writes require admin+; UPDATE checks destination folder too. |
| Quotation PDF metadata listing | Replace public bucket-wide SELECT with authenticated, visible-quotation access. Public URL delivery for explicitly shared PDFs remains part of the product. |
| Mapped IPv6 SSRF bypass | Canonicalize and inspect mapped IPv4 addresses; reject non-HTTP protocols and non-public addresses. DNS resolution is still not pinned to the transport connection. |

## Validation status

Independent source review checked all 13 pre-fix records and separately reviewed
the TypeScript and SQL corrections. Regression tests were added for retained
media IDs, mismatched sender relationships, conversion RPC failures, stale
notification recipients, stored PDF injection and mapped IPv6 addresses. A
mocked renderer test checks browser options, request rejection and cleanup.

**These tests, typecheck, lint, build and SQL migrations have not been run.** The
audit skill requires an OS sandbox with no external network, an empty allowlisted
environment, read-only source/toolchain, scratch-only writes, and explicit CPU,
memory, process, file-size, disk and wall-time limits. This host does not provide
all those controls. No dependencies were installed, browser launched, deployed
service probed, provider contacted, or database changed.

In a disposable environment providing all those controls, with existing local
dependencies, dummy environment values and all providers mocked:

1. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
   Investigate failures; the tests are not evidence until they pass.
2. Initialize an isolated Supabase/Postgres database using migrations through
   076. Run `supabase/tests/security_boundaries.sql` as its local database owner
   with stop-on-error enabled. This fixture rolls back its data.
3. Exercise the database cases below using dummy users and mocked Storage.
   Check both denied operations and successful authorized controls. Keep the
   database and all browser/provider traffic isolated from external networks.

## Database acceptance cases

| Boundary | Required result |
| --- | --- |
| Internal RPCs | anon/authenticated cannot execute either internal RPC; service_role can. |
| Relationship inserts/updates | Cross-account contact/conversation references fail with 23514 before auto-lead or conversion effects; same-account references succeed. Parent account changes fail. Contact deletion retains existing FK behavior. |
| Conversion RPC | Viewer and foreign-account caller denied; agent assigned to conversation but another agent's deal denied; own or unassigned linked lead succeeds; admin succeeds. An authorization or enqueue error rolls back both deal and event. Concurrent reassignment/removal cannot enqueue after authorization is revoked. |
| Membership concurrency | Use two local sessions. Hold target profile lock in session A and remove member; start role/phone/ownership operation in B and verify it waits. Commit A; B must recheck and reject the now-foreign target. Repeat with caller removal/demotion and reversed operation order. |
| Lock order | Concurrent ordinary deal status update and conversion RPC must complete or return an authorization error without a deadlock. Repeat membership removal against assignment/notification writes. |
| Notifications | After removal, old-account notices are unreadable and cannot be marked read; new old-account inserts for the removed user produce no notice. Current members receive notices. Conversation/deal/config saved references are cleared. |
| Storage mutation | Viewer cannot insert, replace, move or delete chat/flow/AI objects. Agents can write own-account chat/flow; only admin+ can write AI media. Cross-account destinations fail. Legacy flow UID folders retain original-uploader access for current agent+ users. |
| Quotation PDF listing | Anonymous and foreign-account listing returns no metadata; assigned agent/admin can list visible quotation paths; unassigned agent cannot. Verify intended public PDF links still deliver via local Storage. |
| Quotation JSON | Invalid shopDrawingDays, unknown keys, malformed/null payment schedule/trigger values rejected; valid partial drafts accepted. Invalid historical saved exports fail before browser launch; normal exports render correctly with embedded fonts. |

## Preflight and rollout

Before any deployment, inspect applied migration versions, function owners,
grants, all permissive Storage policies, and public bucket settings against a
local clone of the schema. Additional deployed policies can broaden access.
Migration 076 intentionally does not rewrite historical bad relationships or
delete old notifications/objects. Identify and repair inconsistent data with an
explicit owner-reviewed data plan before relying on new relationship writes:

```sql
SELECT c.id, c.account_id, c.contact_id
FROM public.conversations c JOIN public.contacts p ON p.id=c.contact_id
WHERE c.account_id IS DISTINCT FROM p.account_id;

SELECT d.id, d.account_id, d.contact_id, d.conversation_id
FROM public.deals d
LEFT JOIN public.contacts p ON p.id=d.contact_id
LEFT JOIN public.conversations c ON c.id=d.conversation_id
WHERE (p.id IS NOT NULL AND d.account_id IS DISTINCT FROM p.account_id)
   OR (c.id IS NOT NULL AND d.account_id IS DISTINCT FROM c.account_id);
```

Historical invalid quotation JSON also needs repair before export; no automatic
sanitization changes commercial terms. Historical stale recipients are blocked
by membership-aware notification RLS even without cleanup.

After isolated checks pass, apply migration 076 **before** deploying the route
that calls `record_conversation_conversion`. Verify its effective grants/policies
and normal dummy workflows in staging. No migration, deployment, commit or push
was performed as part of this remediation. Reverting the route alone leaves the
new security constraints active; do not restore old permissive grants/policies
as a routine rollback.

## Release verification update — 19 October 2026

The unrun status above records the original 17 October audit session. Subsequent
commit preparation ran the normal suite successfully (1,388 tests), TypeScript,
and the deployment's webpack production build. Lint passed with zero errors and
36 existing warnings. A real headless-browser smoke test generated a PDF using
the hardened renderer; the local Chrome channel substituted for the container's
bundled Chromium.

An isolated in-process PostgreSQL/pgvector database replayed migrations 001–077
with minimal synthetic Supabase auth/storage bootstrap schemas, then passed
`supabase/tests/security_boundaries.sql`. This verifies the fixture's SQL/grant,
relationship, notification and authorized/denied conversion cases, not live
Storage service behavior or the unexercised two-session concurrency scenarios.
Production migration 076 remains unapplied; a read-only query confirmed its
conversion RPC is absent. Migration 077 was applied during the earlier catalog
preview repair. No production deployment was performed during commit preparation.

The Docker image now checks database compatibility before starting, and the
updater checks the candidate before promotion. Missing 076/077 blocks promotion
without replacing the running application. `node --test
deploy/check-database.test.mjs` passed all four preflight regression cases.
