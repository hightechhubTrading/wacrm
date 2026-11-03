# Conversation responsibility and work states

The inbox customer inspector now obtains its responsible sales person from the active conversation's `assigned_agent_id`, resolving that auth-user ID to an account-scoped profile name. Reassignment and unassignment update the displayed person; an unassigned conversation never falls back to a different stored deal owner. This matches the existing pipeline card's conversation-owner rule. Persisted legacy deal ownership and its RLS permissions are not rewritten by this display change.

The user approved nine conversation states: new enquiry, following up, preparing quotation, waiting for customer, site visit/measurements, execution/installation, maintenance/after-sales, completed and cancelled. These appear in the header's styled status menu, the message preview and inbox filters, including shareable/saved filter URLs. Legacy general-status choices remain available.

Migration 095 adds nullable `conversations.work_status`, a validated set of state codes and a lifecycle trigger. New open conversations start with `new`. Work states map to the existing lifecycle: waiting for customer is pending; completed/cancelled are closed; other work states are open. A normal lifecycle change, such as reopening a completed conversation, removes a contradictory work-state label. Existing conversations retain their classifications until explicitly changed; the migration does not infer past sales progress.

The existing RLS-invoker `inbox_list` RPC now returns the work state and supports `work:<state>` views/counts. Before replacement, its live source hash was verified against migration 084. Existing account/assignment visibility, search, tags, queues, sorting and keysets are retained. Deployment preflight requires the new column before promotion. Status changes wait for a successful persisted response, show an error on failure and refresh queue counts.

## Verification

- 1,641 unit tests pass, 68 skipped; TypeScript and production build pass.
- 34 database deployment-preflight tests pass, including rejection of a missing migration 095.
- The disposable 1,500-conversation SQL fixture verifies existing queues, filters, metadata and three keyset sorts, plus work-state persistence/counts, lifecycle mapping, reopening, new-conversation defaults, invalid-state rejection and account/assignment/viewer/anonymous boundaries.
- Eight real menu/customer-inspector browser journeys cover English/Arabic, light/dark and mobile/desktop. They verify state choices, lifecycle values, general reopening, actual conversation-assignee names, reassignment/unassignment and account-scoped profile lookup. All transport is synthetic; no messages or live records are created.
- The linked-database owner-scoped smoke verifies status save, work-view projection, pending/closed mapping and reopen reset without changing the assigned person. All smoke writes are rolled back.
- Changed-file lint has no errors; three pre-existing image warnings remain. UI review focus findings were fixed; remaining hardcoded-colour information relates to existing UI.

Migration 095 is recorded as `20261103073854`. Private snapshots, SQL smoke results and browser screenshots are under `.local/conversation-workflow*`, outside git and container build context.
