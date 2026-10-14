# Shared workspace component reference

The implementation lives in `src/app/design-system.css`, imported by the
DashboardShell between the legacy workspace layout and inbox composition.
Neutral colors and readable light accents come from this shared file. Public
login/join pages keep their existing styles. This is a code reference, not an
extra navigation destination in the CRM.

| Pattern | Implementation | States and behavior |
| --- | --- | --- |
| Fullscreen shell | `dashboard-shell.tsx`, `sidebar.tsx` | 72px desktop navigation, labelled mobile drawer, current-route state, visible unread badges, account and mode controls. Mobile drawer keeps existing Escape/focus isolation. |
| Page identity | `workspace/page-identity.tsx` | Icon material, title and description; route owns its actions and permissions. Long descriptions wrap. |
| Actions and fields | existing `ui/button.tsx`, `ui/input.tsx`, `ui/select.tsx`, `ui/textarea.tsx` | Shared sizing, primary/secondary hierarchy, disabled and keyboard focus. Native date/status fields retain their behavior. |
| Customer identity | Contacts table | Initial tile, readable name and keyboard-accessible detail button; phone numbers use LTR direction. Existing sheet handles tags, notes, fields and deals. |
| Metrics | `dashboard/metric-card.tsx` | Tabular values, accent lead metric, separate subtitle/delta size. Counts and comparisons still come from existing queries. |
| Attention / schedule | `dashboard/agenda.tsx` | Priority and unread conversations, linked follow-ups, team presence, loading/error/empty states. Missing services remain unavailable. |
| Deal cards | `pipelines/deal-card.tsx`, `pipeline-board.tsx` | Stage color, customer, value, close date, assignee and separate quotations/job actions; drag semantics are unchanged. |
| Campaigns / automations | Broadcasts and Automations routes | Existing delivery outcomes and trigger/state metadata with common table/task-row styling; creation and send safeguards remain. |
| Flow cards and editor | Flows route, `flows/flow-editor-shell.tsx` | Readable workflow cards; editor fills main area, with existing canvas/list switching and node inspection. |
| Quotation workspace | `quotations/quotation-list.tsx`, quotation detail route | Localized status table, product-code creation, document header with totals. Shaped loading, empty and retry states; stale list responses cannot replace a newer filter. |
| AI test transcript | `agents/ai-playground.tsx` | Localized composer and states, user content right and assistant content left, automatic content direction, reset and existing handoff display. Requests retain the same payload. |
| Notification timeline | Notifications route | Date dividers derived from existing records, unread state and existing mark-read actions. |
| Settings | Settings route, `settings/settings-rail.tsx` | Persistent section rail on desktop, horizontal section navigation on mobile, coherent content surface; section permissions and save behavior remain. |
| Job tasks | `jobs/group-work.tsx` | Contextual task cards, status treatment and readable fields; handoff/sending/upload logic remains unchanged. |

The shared palette also reaches portal dialogs, dropdowns and sheets so they
match the page beneath them. Reduced-motion and increased-contrast preferences
are honored in the workspace. These patterns do not establish full WCAG
conformance; inspect the complete user flows before claiming certification.

The inbox customer inspector (`inbox/contact-sidebar.tsx`) has fixed identity
and four views, with semantic icon colors and readable labels. Sales metadata
and action tiles live in `inbox/sales-workspace.tsx`; the optional controlled
job selection preserves the original component's standalone behavior. Customer
and deal custom-field groups remain available behind disclosures. File jumps,
tag actions, notes and group/quotation sheets retain their existing endpoints.

Arabic UI typography is supplied by the installed Tajawal files through
`next/font/local` in `src/app/layout.tsx`, with locale-specific typography rules
in `globals.css`. The queue header separates primary views from collapsible
refinements; applied criteria remain visible as chips and result counts refer
to the visible list. `conversation-list.tsx` owns those controls and their
existing filter state; it does not introduce new data queries.

The visible AI conversation note is exported as `AiConversationNote` from
`inbox/ai-thread-banner.tsx`. `message-thread.tsx` places it beside the reading
column when there is room, or above the transcript on narrower screens. It
uses existing handoff/context summaries and falls back to the most recent
AI-generated `contact_notes` record scoped to the conversation. Its glass
gradient, expand control and decorative orbit icon live in
`inbox-workspace.css`; reduced-motion disables the orbit. The AI-controls
button opens the Assistant view in the conversation controls sheet. Auto-reply
ownership actions keep their existing endpoint and payload.

Conversation controls now live in `message-thread.tsx` as a compact status/
shortcut toolbar and a Base UI sheet with Assistant, Follow-ups and Sales
tabs. `AiThreadBanner` exposes status separately from ownership actions;
`AiFollowups` supports a standalone panel with loading/error/retry states.
The composer labels AI drafting, templates, and Product photos & files. The
saved library opens searchable product cards with photo thumbnails, document
choices, empty/error/retry states, and explicit Add to reply actions. Selecting
stages the existing shared asset for review; discard never deletes it. The
paperclip menu groups device uploads separately from interactive messages and
quick replies. Expired sessions keep
one template call to action. Existing send, ownership and follow-up
mutation payloads are retained.

`inbox/sales-assistance-brief.tsx` adds the checked next action and actually
saved facts to the glass AI note. It requests an editable draft through the
existing composer or opens templates for expired sessions.
`settings/sales-assistance-settings.tsx` is reached through AI agents → Setup
and owns the independent opt-in and approved tag rules. See
[sales-assistance.md](sales-assistance.md) for execution and activation.

Shared Switch thumb motion mirrors in RTL. Shared Select values/padding and
indicators use logical alignment; AI setup supplies locale direction for
positioning. Sales assistance uses the shared anchored tag picker with a
scrolling list, and bounded activation/rule controls within its full-width
card. Selection/save payloads retain their original behavior.

Saved-product library verification (2026-10-14): 12 synthetic browser checks
passed English/Arabic, light/dark, and desktop/tablet/phone layouts. They cover
thumbnail choices, product/file search, image/document staging, explicit send,
shared-original retention, and empty/error/retry states. Separate English/Arabic
checks passed expired-session and viewer gates. TypeScript and scoped lint passed.
The isolated optimized production build also passed for this revision
(`/tmp/product-library-build.txt`). Browser testing used synthetic accounts and
mocked sends; no customer messages were sent.

Customer Overview refinement (2026-10-14): source-labelled shared map pin, one
current/latest deal, collapsed tags/details, and dedicated Files/Notes views replace
repeated counters and file previews. `lib/inbox/shared-location.ts` validates the
inbound map URL before linking it. The map card represents a customer message;
AI field writes remain a separate gated workflow.

Map sharing (2026-10-14): the customer location card exposes Copy link beside
Open map, copies the validated map URL, shows a temporary Copied state, and
reports clipboard failures without blocking map navigation. Labels are localized.

Pre-push verification (2026-10-14): 1,206 unit tests passed, 27 skipped;
TypeScript and the isolated optimized production build passed. Twelve synthetic
map-copy checks passed English/Arabic, light/dark and 2560/1280/390px, including
exact clipboard contents, Copied feedback and denied clipboard handling. Scoped
sidebar lint has no errors and one existing avatar-image warning. Testing sent
no customer messages. Temporary verification artifacts live under `/tmp`.
