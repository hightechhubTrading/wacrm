# Internal sales assistance

This is the first phase: approved automatic tags, evidence-backed detail capture,
and a prepared summary/next action. It runs on new customer text, shared map locations and transcribed
voice messages, including human-owned and AI-paused chats. It never sends a reply,
creates a quotation, confirms a visit or moves a deal. A salesperson can prepare
an editable reply from the note; expired sessions open approved templates.

## Activate

1. Apply `supabase/migrations/072_sales_assistance.sql` after migrations 068–071.
   This adds internal state, tag suppression, tag rules and the account opt-in.
   Existing history is not classified or backfilled. New messages receive an
   ingestion timestamp to resolve Meta messages sharing the same second.
2. Configure the existing generative provider and active AI. Supply the existing
   server-side `TYPESAFE_API_KEY`; keep the overall `TYPESAFE_MODE` as intended.
3. In **AI agents → Setup → Sales assistance**, enable preparation. Approve
   existing tags with a clear rule. Fields use the existing contact AI-collectible
   settings and current deal's stage field groups; deal groups must be deal-scoped.
4. `TYPESAFE_SALES_ASSISTANCE_MODE=shadow` is the default: verified recommendations
   appear, but no tags or fields change. Review representative bilingual cases.
   Set it to `enforce` to apply verified tags and empty-field captures, or `off`
   to stop this workflow. Overall `TYPESAFE_MODE=off/shadow` still bounds it.

Migration 072 was applied to the linked app database on 2026-10-14 (see the
application record below). Account activation, application deployment and paid
live evaluation were not performed. The 0.9 verification threshold is an initial conservative
policy, not domain calibration or a correctness guarantee.

## Execution and boundaries

`dispatchSalesAssistance` starts alongside the existing auto-reply dispatch inside
webhook `after()`. Both promises are awaited; internal preparation does not delay
starting a customer reply. Control messages, consumed flows and interactive menu
turns are excluded. Text/transcript evidence is bounded to recent turns; unseen
files, image descriptions and quoted assistant offers are not field evidence.

The configured provider proposes closed-set tag IDs, field/source/value triples,
a brief and one next action. Jev checks summary/action support and each proposed
tag/field independently in one request. Unknown IDs, unsupported values, wrong
field types and uncertain checks are rejected. Existing saved fields and recent
team replies inform the recommendation. Usage and Jev checks have their own
`assistance` workflow/mode entries. The pass has an in-process account limit of
20 analyses/minute; this is not a distributed spending cap.

A database claim deduplicates repeated delivery. Applying results checks the
current customer message, run token, account switches, unchanged tag rules and
current order/stage under locks. Tags and field writes are one transaction. Existing
non-empty values are retained. Human tag removal records suppression atomically;
a deliberate manual add clears it. Existing auto-reply product tagging honors the
same suppression. Changing a field is left to the team in this phase.

**New internal assistance tags do not dispatch `tag_added` automations.** This
prevents an internal classification from unexpectedly sending messages or starting
flows. Manual and legacy auto-reply tagging retain their existing dispatch logic;
if an internal pass already inserted a tag, a later duplicate will not dispatch it.
Select rules with that behavior in mind. No new tag definitions are invented.

The glass note displays the checked recap, facts actually saved by this pass and
one next action. It offers a reviewed reply/template action. Realtime updates and
30-second polling refresh it; the customer inspector refreshes on assistance
updates. Failed preparation leaves existing messaging available. Group contact
fields, human-value corrections, automatic task creation, scheduling and quotation
assembly are beyond this first phase.

## Local verification

- Full unit suite: 1,194 passed, 27 skipped, including new parser/verifier, shadow/
  enforce, configuration permissions, human tag correction and legacy regressions.
- Executed migration in an isolated PGlite PostgreSQL engine with synthetic schema:
  tenant/source gates, claims, atomic contact/deal writes, suppression, human edits,
  stale tokens, switch-off during generation, preview mode, changed orders/rules,
  same-second messages, already-answered replies and authenticated RLS boundaries.
- Twelve inbox/setup layouts: English/Arabic, light/dark, 2560/1280/390px. Captured
  facts, reviewed draft action without sending, opt-in and tag rule editing passed.
- TypeScript, the isolated optimized production build and scoped lint passed; lint retains two existing avatar warnings.

Tests use synthetic data and mocked model/provider operations. They do not measure
classification accuracy on actual sales conversations or prove live deployment.
The external SSD filled; reinstallable SWC, TypeScript and type packages were moved
to `~/Library/Caches/wacrm-dependencies` with local node_modules symlinks. No source
or customer files were deleted. Verification caches/builds use internal `/tmp`.

## Database migration application, 2026-10-14

Migration 072 was applied to the workspace-linked Supabase project
`iuhnjukxcgbxskxesnqw`, which matches both app environment URLs. Prerequisite
migrations 068–071 were confirmed in remote history. The remote history uses
timestamp versions, so only this SQL was executed, rather than pushing the
unmatched local numbered migration history. Schema changes and history record
`20261014122424 / 072_sales_assistance` committed in one transaction, with
lock/statement deadlines and a PostgREST schema-cache reload notification.

Post-apply checks confirmed all three columns, both tables with RLS, expected
service-only claim/apply grants, authenticated human-override access, no anonymous
override access, realtime publication membership and expanded usage/audit
constraints. Service API schema reads and a non-existent-conversation RPC probe
passed. All accounts remain opted out; the two new internal tables are empty.
Existing history was not classified. Application deployment and account activation
are separate from this completed database migration. Verification output is local
in `/tmp/wacrm-migration-072-{preflight,apply,verify}.json` and
`/tmp/wacrm-migration-072-api-check.txt`; these contain no credentials or customer
exports.

## Setup control alignment, 2026-10-14

The shared switch thumb now reverses its checked translation in RTL and stays
inside the track. AI setup supplies Base UI's locale direction explicitly.
The native tag dropdown is replaced with the shared Select, anchored above/
below its trigger rather than overlapping the selected value; long lists
are capped at 20rem and scroll. Provider fields also use full-width triggers
and anchored menus. Select labels, padding and selected-item indicators use
logical alignment. Activation and rule controls are bounded to 52rem within
the full-width workspace, with spacing between setup cards.

Twelve synthetic checks passed English/Arabic, light/dark and 2560/1280/390px:
checked-thumb bounds/direction, field/menu width and viewport placement, long
labels, selection, Escape/focus restoration, unchanged settings payloads and
provider menus, without document overflow/browser errors. TypeScript passed;
scoped lint has no errors and one existing callback dependency warning.

The isolated optimized production build passed for this alignment revision.

## Shared locations and customer overview, 2026-10-14

A reported shared pin was already persisted as a `location` message, but the
internal webhook gate and evidence query excluded that type. Both now use
`SALES_ASSISTANCE_CONTENT_TYPES` (text/audio/location). The existing inbound mapper
provides a map URL and optional customer label; the model is instructed to copy
that exact URL to an allowed Location field, without inventing an address or
confirming a visit. Existing source-span verification, empty-field protection,
account opt-in, preview/enforce behavior and deal-stage scope remain in force.
No database migration or historical backfill is included.

Read-only inspection of the reported conversation confirmed one stored customer
location, active opted-in assistance, and no internal-assistance record. Local
configuration defaults the independent assistance workflow to shadow; the Location
field group is also absent from the current deal stage. Processing location messages
fixes the missing evidence; applying custom-field values additionally requires
enforce mode and an eligible stage-linked group. Configuration and stage assignments
were not changed during this diagnosis.

The customer Overview now shows a source-labelled shared pin with Open map and
View original message, plus one current/latest deal. Repeated statistic tiles and
shared-file previews are removed from Overview. Tags and customer details start
collapsed; Files and Notes retain their dedicated views. The map card reads the
loaded customer messages, does not claim an AI field write, and is independent of
AI activation. Invalid coordinate URLs cannot become sidebar links.

Verification: synthetic English/Arabic, light/dark and 2560/1280/390px browser
checks passed location-link/source access, progressive disclosure, Files navigation
and overflow checks. Focused unit tests cover location evidence in enforce/shadow,
field verification and invalid map inputs. Tests use mock models and messages;
no customer messages or live settings were changed.

This revision passed 97 focused tests, TypeScript and the isolated optimized
production build. Scoped lint reports no errors and one existing native-avatar
image warning. Artifacts: `/tmp/location-sidebar-unit.txt`,
`/tmp/location-sidebar-browser.txt`, `/tmp/location-sidebar-types.txt`,
`/tmp/location-sidebar-lint.txt`, `/tmp/location-sidebar-build.txt`.
