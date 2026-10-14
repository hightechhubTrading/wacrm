# Workspace design: Triage + Agenda

The selected prototype direction is now implemented in `/inbox` and `/dashboard`.
The shared shell uses Inter for the English UI and locally bundled Tajawal for
the Arabic UI, neutral layered surfaces, restrained
accent colors, 20px dashboard panels, and a quiet active navigation state.
Existing profile themes and appearance modes remain supported.

## Ownership

- `src/app/workspace.css`: scoped workspace surfaces and responsive composition.
- `src/app/(dashboard)/dashboard-shell.tsx`: auth, presence, profile synchronization,
  shared navigation, mobile drawer state, and dynamic viewport sizing.
- `src/lib/inbox/triage.ts`: priority → unread → active → resolved ordering.
  Closed conversations never enter attention groups. Urgent precedes high;
  remaining conversations sort by most recent message without mutating input.
- `src/components/inbox/conversation-list.tsx`: triage sections, All/Unread/Mine,
  search and existing status, company, tag and agent filters, load errors/retry.
- Inbox thread, bubbles and composer: plain surfaces, priority context from the
  existing AI flag/reason, preserved sending/media/assignment/status tools,
  mobile composer with a full-width input and a separate tools row.
- `src/lib/dashboard/agenda.ts`: account-scoped, RLS-backed attention queries,
  follow-ups belonging to the current user or without an owner, and team members.
- `src/components/dashboard/agenda.tsx`: conversation links, follow-up links,
  localized dates, genuine presence and independent empty/unavailable states.
- Dashboard route: agenda first, compact metrics and shortcuts, analytics in an
  expandable section, existing activity feed.
- `src/components/inbox/ai-followups.tsx`: `?followup=id` opens the work panel;
  completion still follows the existing evidence workflow.
- `messages/en.json`, `messages/ar.json`: new interface copy and matching ICU keys.

## Data behavior

Attention lists merge and deduplicate separately counted priority and unread
queries. Those counts overlap and must not be added together. The first six
attention conversations and first six follow-ups are shown. Agenda refreshes
on mount and every 30 seconds while the document is visible. Presence retains
its existing realtime and staleness behavior. No guessed urgency or invented
workload figures appear. A missing follow-up table displays unavailable;
no database migration is applied by this UI change.

## Local validation

Synthetic Supabase fixtures were used for browser checks; no customer messages
were sent. Dashboard and inbox rendered at 1440, 1280 and 390px in English/Arabic,
light/dark (24 renders): no horizontal overflow or browser exceptions. Checks
also cover search, Mine, mobile back, analytics disclosure, follow-up deep
links, mobile composition/send with a mocked endpoint, drawer Escape/focus
isolation, and missing follow-up service behavior. Triage/query unit tests and
translation parity checks accompany the change. The full suite passed 1,119
tests (27 skipped); TypeScript and the optimized production build passed.
Scoped ESLint reported no errors and five existing warnings. These checks do not establish
production migration state, deployment, or live WhatsApp delivery.

The exploration routes have been removed after promotion. Production pages do
not import any prototype assets or picker code.

The local `.next` folder is redirected to `/tmp` because the external drive
is nearly full. Build verification required `NODE_PATH` and a temporary
`/tmp/node_modules` link so generated external-package links resolve correctly.
No application configuration was changed for this workaround.

## Chat selection navigation fix

Selecting or closing a chat uses Next.js’s native History API integration
to update `c` locally. It does not navigate the server route through
`router.replace`. The previous path issued an RSC request on every click and
kept Next’s rendering state pending until that request completed. The URL
keeps unrelated parameters and drops stale `followup` targets when switching
chats. Reload and shared deep links still select the intended conversation.

A browser regression check blocks all RSC navigation after initial load:
five rapid switches issue zero route requests, keep both desktop panes mounted,
preserve messages on repeat clicks, restore selection after reload, and return
to the list on mobile back. Continuous looping was not reproduced with the
synthetic fixture; the redundant navigation and its pending state were verified
before the fix and removed afterward.

## Structural chat revision, 2026-10-13

After reviewing the actual screen, the user requested a visibly different
chat design. The inbox now has its own scoped stylesheet,
`src/app/inbox-workspace.css`, imported by the dashboard shell. This revision
changes composition: a 76px desktop navigation rail, detached triage panel,
a reading panel capped at 1120px, message columns capped at 820px, and
a floating composer dock. At smaller widths the contact identity and controls
use separate rows. The normal labeled mobile navigation drawer remains.

Messages use softer neutral/accent surfaces and sender captions instead of
large saturated blue blocks. Long replies stay within a readable width;
reply quotes use neutral-surface colors. Customer, agent, AI, and automation
labels remain distinct. Dates follow the interface locale, and the short
composer placeholder has a keyboard-shortcut tooltip. Details remain available
in the optional contact panel. Follow-up work uses a bounded scrollable
support region so it does not displace the entire conversation.

Synthetic browser verification covers 12 inbox renders at 2560, 1280 and
390px, English/Arabic, light/dark, plus contact panel opening at 1280px.
No horizontal overflow or page exceptions occurred. Rapid selection/reload/
mobile back checks retain zero server route requests during chat switches.
These tests do not verify a production deployment or live message delivery.

The revised production build passed in an isolated checkout using the same
application sources and synthetic Supabase configuration. Additional checks
passed for mobile mocked sending, drawer Escape/focus isolation, unavailable
follow-ups, long Arabic content, quoted replies and expired-session templates.
No customer messages were sent and no deployment was made.

## Light appearance contrast, 2026-10-13

The light workspace now uses darker secondary text (#4b5565), a more distinct
canvas (#e8ecf2), white cards, and clearer neutral borders. Search and composer
boundaries use #778396; the selected conversation and filter receive visible
outline treatment. Message captions, timestamps and previews have stronger
contrast, and disabled message placeholders retain legible text. Each saved
accent has a darker light-mode variant; warning/error colors are deepened in
the thread and portaled status menus. Dark appearance retains its palette.

Rendered contrast checks cover message text, timestamps, sender captions,
previews, group/priority labels, status/filter controls, placeholders and
navigation/header icons across all six accent themes. The lowest sampled text
contrast was 4.95:1; the lowest sampled icon contrast was 4.51:1. These are
focused checks of the inbox, not a full accessibility conformance audit.

## Sender alignment and quieter surfaces, 2026-10-13

Message positions are physical: customer messages are on the left; agent and
bot replies are on the right, irrespective of the interface locale. The
MessageActions row and MessageBubble caption wrapper explicitly use LTR
layout. Message bodies and translations use `dir="auto"` so Arabic text still
flows RTL and English text LTR. Timestamp/status groups use LTR direction
to retain stable time and delivery-icon ordering. This corrects the previous
bug where inherited RTL reversed flex start/end placement.

The light canvas is now a quieter neutral (#f1f2f4). Prominent panel and bubble
outlines were removed, while secondary text remains #4b5565 and the composer
and search retain subdued boundaries. The revised sampled text contrast was
at least 5.24:1 across six accents; icons at least 4.74:1.

Eight browser renders verify sender-side geometry, text direction and
timestamps in English/Arabic, light/dark and desktop/mobile. Six component
regression cases pin the independent layout/text direction boundaries.

The focused inbox suite passed 16 tests. The latest whole-workspace TypeScript
run encountered optional `action.work` errors in the separately added
`sales-workspace.tsx`; that concurrent component was preserved. Browser and
component direction checks passed independently.

## Reference-led connected inbox, 2026-10-13

After the user supplied design references, the inbox composition was rebuilt
as one connected application frame. The desktop rail, triage list, conversation
and customer context touch along shared boundaries. The desktop frame is capped
at 1920px, with a 72px rail, 312px conversation list and 292px context panel
(adjusted on smaller laptops). The duplicate desktop header is hidden; appearance
controls remain on the rail. Mobile keeps the header and labeled navigation drawer.

The customer panel defaults open on desktop while honoring the existing device
preference. Its shared-files section derives from loaded conversation messages
and navigates to the matching message, with keyboard focus and reduced-motion
handling. Mobile opens customer context in the existing sheet.

Consecutive messages from the same author and origin within five minutes share
a sender caption. Different team members, customer/agent/automation roles and
AI/human origins start new groups. Sales actions, priority context, follow-ups
and AI ownership controls remain in the compact Work & AI disclosure; follow-up
deep links expand it. Sending, status, assignment, reactions, quotes, templates,
media and role gates retain their existing workflows.

Messages have a loading skeleton and an error/retry state separate from an empty
conversation. Browser checks covered 16 layouts at 2560/1440/1280/390px in
English/Arabic and light/dark, connected panel geometry, grouped captions and
shared-file navigation. Additional checks passed for error/retry, appearance,
context collapse, Work & AI, mocked sending, mobile context/file navigation and
rapid switching/reload/mobile back without RSC requests on selection.

The full suite passed 1,165 tests (27 skipped), TypeScript passed, scoped lint
reported no errors (two avatar-image warnings), and the optimized production
build passed in an isolated checkout with synthetic Supabase configuration.
Sampled contrast checks passed across all six accents (minimum text 5.20:1,
icons 4.97:1). These are local synthetic checks, not production deployment or
a full accessibility certification. The dashboard awaits review of this inbox
before adopting the connected direction.

## Fullscreen and operational controls, 2026-10-13

The connected frame's 1920px cap and outer margins were removed after feedback
that the workspace looked like a mockup rather than a full-screen application.
The desktop inbox now uses the full viewport, while the message reading column
remains bounded. An unselected chat no longer renders an empty customer panel.
The empty thread has a composed illustration and readable heading; follow-ups
use shared buttons/inputs, task cards, status labels and grouped form fields.
Behavior and API payloads remain unchanged.

The proposed whole-app sequence and common visual rules are recorded in
[design-system-rollout.md](design-system-rollout.md). Other route redesigns
are planned, not claimed as implemented by this revision.

Local checks for this refinement passed: 16 selected-chat renders across
2560/1440/1280/390px, English/Arabic and light/dark; eight unselected desktop
renders with exact viewport bounds, no empty inspector and no document
scrolling; desktop/mobile follow-up validation and unchanged completion/create
payloads; error/retry, theme toggle, context collapse, file navigation and
mocked sending. Fifteen focused regression tests and TypeScript passed.
Scoped lint had no errors, with native-avatar and existing unused-import
warnings. These checks used synthetic data and mocked writes.

## Shared CRM visual rollout, 2026-10-13

The authorized next phase is implemented locally. Shared color, surface,
field, action, table, overlay and reduced-motion rules live in
`src/app/design-system.css`. The inbox no longer owns duplicate theme tokens.
All desktop routes share the 72px navigation rail, with badges kept visible;
mobile retains its labelled drawer and focus behavior.

Dashboard, Contacts, Pipelines, Quotations, Broadcasts, Automations, Flows,
AI Agents, Notifications, Ad Conversions and Settings use this common visual
language. Direct changes include page identities, dashboard metric/agenda
composition, customer identity buttons, deal value/ownership hierarchy,
flow/automation cards, quotation states and totals, an Arabic/English AI
transcript, notification date divisions, settings section treatment and job
task cards. Existing workflows and payloads remain owned by their original
components. Contacts retain their existing columns; no new database field is
introduced by this visual rollout.

The component inventory is in [workspace-components.md](workspace-components.md).

Local rollout checks passed: 208 populated/empty route layouts covering 13
screens at 2560/1440/1280/390px, English/Arabic and light/dark, with fullscreen
bounds, no document overflow and no browser exceptions. Interaction checks
cover contact keyboard inspection/selection, quotation unavailable/retry/
empty states and rapid status filtering, unchanged quotation-create payload,
AI test send/reset payloads and mobile drawer Escape. Sampled dashboard text
contrast across all six accents in both modes has a minimum of 5.68:1; this
is a focused check, not a complete accessibility audit.

The complete suite passed 1,165 tests (27 skipped), and 20 focused locale,
menu and message-direction tests passed after the shared primitive changes.
TypeScript passed. Route lint reported no errors and nine existing hook/
unused-import warnings; the final modified components have no lint errors.
Screenshots and writes used synthetic fixtures/mocked endpoints. These checks
do not verify deployment, database migrations or live customer delivery.

The final isolated optimized production build passed using synthetic environment
values. The inbox also passed 16 final connected-layout renders, message
grouping and shared-file navigation against the shared palette. The user's
existing development server remains running on port 3100; its build cache was
not used for production verification.

## Customer inspector revision, 2026-10-13

The customer sidebar now has a fixed identity/contact header and four labelled,
icon-led views: Overview, Sales, Files and Notes. The overview presents real
record counts, deal summaries, readable tag markers and recent shared files;
custom fields remain behind a disclosure. Changing views returns their scroll
position to the top. Sales shows one selected job, value, stage, owner and
quotation, with visit/report/workshop/quotation action tiles. Selecting a deal
from the overview opens that record; selection persists between views.

Blue identifies sales, teal files, amber notes/reports and violet workshop/
custom details. Icons and labels carry meaning alongside color. Arabic has
larger small text and an explicit Base UI direction provider for keyboard tab
navigation. Forms are no longer duplicated in a long default sidebar stack.
Viewer records remain readable and sales actions retain their permission gate.

Local verification passed 12 sidebar compositions (1440/1280/390px, English/
Arabic, light/dark), selected-job action layout, collapsed fields, note and file
states, Arabic keyboard navigation, selection persistence, file jumps, all four
action sheets, mocked note persistence and viewer boundaries. Sampled text
contrast across six accents and both modes has a minimum of 5.03:1. Thirty-two
focused direction/grouping/sales/job tests and TypeScript passed. Scoped lint
has no errors and one native-avatar warning. Browser data and writes were
synthetic; live delivery is not established by these checks.

The isolated optimized production build passed for this sidebar revision.

## Inbox controls and Arabic typography, 2026-10-14

The queue header now has a clear identity mark, a visible-result count, a
44px labelled search field with focus-preserving clear action, and icon-led
All/Unread/Mine controls. Status/sales views, tags, company and agent filters
sit in a collapsible refinements panel. Applied refinements are counted and
shown as removable chips. Clearing refinements resets the view and contact
filters; search remains independently clearable. Existing search/filter
queries and triage ordering are retained.

Arabic uses the installed Tajawal Arabic WOFF2 files at weights 400/500/700
through `next/font/local`. No font dependency was added. English retains Inter;
mixed Arabic content also has an explicit Arabic fallback. Arabic headings
and controls avoid Latin-style negative tracking. The bundled font license
is retained in `public/fonts/tajawal-OFL.txt`; quotation templates are unchanged.

Twelve queue renders verified English/Arabic, light/dark and desktop/laptop/
mobile. Search, clear focus, Mine, company/status filters and resets passed.
Chrome's actual glyph-font inspection confirmed Tajawal-Bold for the Arabic
heading, rather than relying only on computed CSS. Fifty-two Arabic route
layouts across desktop/mobile and both modes passed without document overflow
or browser exceptions. TypeScript and the isolated optimized build passed.
Scoped lint has no errors and one existing native-avatar warning. Checks use
synthetic data and do not establish production deployment.

The external SSD filled during this revision. Generated Vite/TypeScript caches
were moved to `/tmp`; test/build verification used the existing isolated copy
on internal temporary storage. User files were not deleted to reclaim space.

## Floating AI conversation note, 2026-10-14

The saved AI note is now visible outside the Work & AI disclosure. A glass
gradient card occupies the gap between the bounded message column and the
customer inspector when the conversation container is at least 1400px wide.
It mirrors to the customer side in Arabic. Smaller screens show a compact
card above the transcript; messages and the composer remain unobstructed.

The card reads the existing cached context summary, prioritizes a handoff
summary while paused, and falls back to the latest conversation-scoped
AI-generated contact note. It remains visible when auto-reply is disabled.
An absent summary has an explicit empty state; available priority context
is separately labelled. Long notes expand on demand. The AI-controls action
opens and focuses the existing disclosure without changing ownership.

A slow CSS orbit around the sparkle icon provides the requested animation.
Only the decorative ring moves; reduced motion disables it, and reduced
transparency uses an opaque surface. Note text retains automatic direction.

Sixteen synthetic layouts passed across English/Arabic, light/dark and
2560/1440/1280/390px. Checks covered gutter/composer geometry, compact
placement, expansion, control focus, animation, reduced motion and absence
of overflow/browser exceptions. Separate checks passed for AI contact-note
fallback, conversation switching, empty state and paused handoff precedence.

TypeScript and an isolated optimized production build passed. Scoped lint
has no errors and one existing native-avatar warning. Build configuration
uses synthetic Supabase data; these checks do not establish deployment.

## Messaging and assistant controls rethink, 2026-10-14

The tall Work & AI disclosure has been replaced by a compact toolbar and a
separate conversation-controls sheet. The toolbar shows the current reply
owner/status, with Follow-ups and Sales shortcuts. Three icon-led tabs in
the sheet separate automatic reply controls, follow-up work and sales next
actions. Opening controls no longer consumes transcript height. The glass
AI note opens the Assistant tab.

Assistant status distinguishes loading, unavailable, manual, team-owned,
paused and automatic replies. Take-over/resume retain their existing
endpoint/payloads and update the visible status. Explanations distinguish
automatic replies from draft assistance. The composer labels Draft with AI
and Templates and combines attachments, interactive messages and quick
replies in one menu. AI output remains an editable draft until explicitly
sent. The textarea uses automatic content direction. Expired WhatsApp
sessions show one template action and keep free-form sending disabled.

Follow-ups open directly, with explicit loading/error/retry/empty states.
Deep links and sales follow-up events select the correct tab. Sales reply
actions close the controls before opening templates or focusing the reply
field. Base UI retains modal focus isolation, Escape and tab keyboard
navigation; returning to the reply field waits for the sheet to close.

Twelve synthetic layouts passed English/Arabic, light/dark and desktop/
laptop/mobile. Checks covered tab selection, status, modal focus return,
resume payload, draft review before sending and mocked sending without
document overflow or browser exceptions. Additional English/Arabic checks
passed expired session templates, follow-up load retry/create, take-over
payload, follow-up deep links/events, sales template and reply focus, and
unavailable/manual assistant states.

TypeScript and the final isolated optimized production build passed.
Scoped lint has no errors and one existing native-avatar warning.
Verification used synthetic data and mocked writes; deployment was not
performed.
