# Sales Today — 29 October 2026

Implemented locally in the existing dashboard agenda. The current users are salespeople; workers continue using WhatsApp. No worker accounts or direct group integration are introduced.

## Work lists

- **Customers waiting for a reply:** accessible non-closed conversations whose latest non-failed customer/agent/bot message is from the customer, oldest first. Read state and AI priority are not used as substitutes. Internal messages are ignored; equal timestamps use message ID as a stable tiebreaker, matching the existing inbox sales-context behavior. Later bot replies count as replies; a failed staff send does not clear the item.
- **Due today or overdue:** active follow-ups belonging to the signed-in salesperson or without an owner, linked to open/pending conversations and due before the next local midnight. Device timezone defines today and displayed dates. Future days are excluded; deferred work appears when its due time falls within the window. Existing take-ownership and inbox update actions remain.
- **Blocked jobs:** recorded blocked handoffs on accessible deals.
- **Measurements & workshop:** recorded waiting/in-progress/ready handoffs on accessible deals. Prepared/unposted requests and completed/cancelled work are excluded. Requested dates remain requests, not confirmed bookings. A text responsible-person label is not a worker login or assignment.

Reply and job scope follows existing RLS: agents see their permitted conversations/deals; admins/owners may see the whole account. Follow-ups are additionally restricted to own/unassigned ownership. Each list shows at most six items with exact counts and a visible preview count if more exist. The inbox and waiting-work queue remain available for broader browsing. No aggregate count adds overlapping conversations, tasks and jobs together.

Conversation and follow-up rows deep-link into the inbox. Job rows open the selected handoff in its existing sheet, with Updates available to view other records. The waiting-work footer opens the existing Pipelines disclosure via `#waiting-work`. Unavailable sections are not shown as empty or caught up.

Lists refresh every 30 seconds while visible, when returning to the tab, and after follow-up or group-work changes. Older overlapping responses are ignored; account/user changes immediately stop showing previous rows and selected jobs. Read-only viewers do not render the sales action section.

## Implementation and deployment

- `src/lib/dashboard/agenda.ts`: caller-scoped reads, independent failure handling, local-day cutoff.
- `src/components/dashboard/agenda.tsx`: four actionable lists, partial errors, refresh and auth-change handling.
- `supabase/migrations/082_sales_today_replies.sql`: read-only, stable, SECURITY INVOKER reply queue using existing conversation/message/contact RLS and the existing latest-message index from migration 071. Anonymous execution is revoked. The function requires agent membership in the requested account.
- `src/components/jobs/group-work.tsx`: selected handoff entry and waiting-work anchor.
- `deploy/check-database.mjs`: null-account read-only RPC preflight; blocks candidate promotion if migration 082 is missing.

Migration 082 was applied after explicit release authorization on 29 October 2026 and recorded as `20261029100117 / 082_sales_today_replies`. Authorized live query, tenant-boundary, anonymous-permission and null-account checks passed. The updater must still verify the application candidate before promotion. No customer messages are sent by these checks.

## Verification

Focused loader, inbox-sales-context, handoff/API and locale tests cover query scoping, date boundaries, independent errors and existing state rules. Deployment probes have Node tests. `scripts/check-sales-today-db.mjs` executes migration 082 in a disposable PostgreSQL-compatible fixture with roles and RLS: latest-sender rules, failed/internal messages, equal timestamps, closed conversations, unread-independent inclusion, tenant/member/assignment isolation, exact counts and preview ordering. It requires a separately installed `@electric-sql/pglite`; alternatively set `PGLITE_MODULE` to its module entry path. The fixture models the relevant tables and policies; it is not a production schema/deployment verification.

`PLAYWRIGHT_CHANNEL=chrome node scripts/check-sales-today.mjs` mounts the production agenda/loader/styles with synthetic auth/data transport. It checks direct links, selected handoff, take/retry, refresh events, missing/empty data, account/role changes and 12 layouts (360/390/1280px, Arabic/English, light/dark). Set `TODAY_CHECK_ARTIFACTS` to an output directory for phone screenshots. The existing handoff browser script covers the underlying request/report/share flow. Physical-device and staff usability testing remain open.

Local results: 50 focused tests and six deployment-probe tests passed, as did the disposable SQL checks, both browser scripts (12 Today layouts and 36 handoff layouts), scoped ESLint, TypeScript and the production webpack build. The build used the existing temporary-output workaround (`NODE_PATH` plus a temporary `/tmp/node_modules` symlink, removed after the check). These results do not establish a live deployment or actual-device usability.

## Authorized release validation

The isolated sales release, based on `030420d`, passed 1,480 ordinary tests (63 skipped), TypeScript, production webpack build, the Sales Today and phone-handoff browser scripts, deployment-probe tests and disposable SQL checks. Unrelated uncommitted language/AI work was excluded. Private migration and deployment evidence is stored under `~/.local/state/wacrm/releases/sales-today-20261029/`. The existing VPS updater owns candidate validation, active-call checks, promotion and rollback.
