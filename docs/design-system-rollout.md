# Workspace design rollout

Updated 2026-10-13. The shared visual rollout is now implemented locally across the CRM.
The sequence below records the design direction and screen compositions;
production deployment and review of live account data remain separate.

## Shared visual rules

The application fills the viewport. Navigation remains anchored; long lists,
threads and inspectors scroll inside their own regions. Reading columns may
be bounded, but the workspace itself is never presented as a floating mockup.

Use the existing theme accents, with three distinct surfaces: workspace,
content, and inset controls. Use quiet dividers between persistent regions;
reserve raised surfaces for overlays and contextual actions. Light mode must
keep secondary text readable; dark mode must distinguish adjacent surfaces.

Use a clear type scale: 24–28px page titles, 16–18px section titles, 14px body
and controls, 12px metadata. Arabic needs comfortable line height and must be
reviewed at actual size. Use tabular numerals for operational metrics and
currency. Dense tables may use 13px body text, with 36–44px interactive rows.

Make hierarchy visible through composition: customer identity, status,
preview, time and action each have a defined place. Pair meaningful icons
with actions, keep secondary actions in menus, and give each task one clear
primary action. Avoid a row of equally weighted links for operational work.

Share button, field, segmented-control, badge, toolbar, table, inspector,
empty-state and skeleton patterns. Define density variants for tables and
chat rather than adding route-specific overrides to every control. Promote
inbox tokens into the shared stylesheet only after checking both themes and
all six saved accents on other routes.

The application shell mirrors for Arabic. Message ownership stays physical:
our messages on the right, customer messages on the left. Message content
uses automatic text direction; numbers, phone numbers and timestamps remain
readable in mixed-language content. Motion is brief and purposeful; honor
reduced motion and preserve keyboard focus.

## Sequence and screen compositions

| Stage | Area | Composition and deliverable |
| --- | --- | --- |
| 1 | Shared foundation | Extract approved inbox surfaces, type and spacing into shared tokens. Align navigation, page headers, controls, focus rings and overlays. Establish a component reference with real states, not a static button gallery. |
| 2 | Dashboard | Triage + Agenda: one strong attention section, a time-based agenda, compact operational metrics and team presence. Charts support decisions and stay secondary. Reuse real counts and existing queries. |
| 3 | Contacts | Full-width searchable table with identity, tags, company and latest activity. A selected contact opens a contextual inspector; editing keeps its existing validation and permissions. |
| 3 | Pipelines | Stage headers with totals, visually composed deal cards with customer identity, value, owner and next action. Preserve drag/drop, stage rules and keyboard alternatives. |
| 3 | Quotations | A document-oriented workspace: status toolbar, readable quote preview and organized editing sections. Make totals and approval/send actions prominent without turning every field into a card. |
| 4 | Broadcasts | Campaign overview with status and delivery outcomes; creation follows audience, content and review steps. Keep eligibility, scheduling and sending behavior intact. |
| 4 | Automations and flows | Automation lists emphasize trigger, action and state. Flow editor retains a full-size canvas with a focused node inspector; run logs use an inspectable timeline. |
| 4 | AI agents | Distinguish configuration, knowledge and playground. Give test output a proper transcript and clear state; keep policy/settings edits separate from operational results. |
| 5 | Notifications and ad conversions | Group actionable notifications by time and type. Present conversions as a filterable report with clear attribution and readable metrics. |
| 5 | Settings | Persistent section navigation, coherent form groups, account/member identity and explicit save feedback. Destructive actions retain their existing safeguards. |
| Throughout | Inbox sales/job tools | Apply the same task-card, status and form patterns to contextual work. Jobs currently live in the inbox rather than a dedicated route; preserve that workflow. |

## Acceptance for each stage

- Review real populated, empty, loading and failed states; use synthetic data
  for verification, never invented production metrics.
- Check English and Arabic, light and dark, and saved accent themes.
- Check 390, 1280, 1440 and 2560px widths: no document overflow, clipped fields
  or empty inspectors. A desktop fills the window; mobile exposes one useful
  primary view and contextual sheets.
- Verify keyboard focus, readable contrast, text zoom, and reduced motion.
- Recheck the affected workflows, payloads, permissions and deep links. A
  visual redesign must preserve operational behavior.
- Capture screenshots before progressing to the next area, so drift is
  visible. Do not declare a whole-app redesign complete after changing CSS.

## Implemented locally

Shared surfaces and accent contrast now come from `src/app/design-system.css`,
including portal overlays. Desktop navigation uses the same 72px rail across
routes, with readable mobile navigation and visible unread indicators. The
workspace stays full-screen; the message reading column remains bounded.

Dashboard uses stronger attention/agenda sections, composed metrics and
shortcuts. Contacts have identity tiles, a keyboard-accessible inspector
opener and visible selection controls. Pipeline columns and deal cards have
clear customer/value/owner treatments. Broadcasts, automations, flow cards,
reports and settings inherit shared controls, tables and surfaces; settings
has a persistent section rail and coherent panel treatment. The flow editor
continues to fill its working area.

Quotations have a localized status table, document header and shaped loading,
empty and retry states. List responses cannot replace a newer status filter.
The AI playground has a localized transcript/composer and physical message
sides. Notifications are divided by date. Contextual job tasks and follow-ups
have the same card/status/field treatments.

Existing data access, permissions, mutation payloads and delivery workflows
are retained. This rollout applies visual and interaction treatments to the
current features; it does not add a new latest-activity database field to the
Contacts table or replace the existing campaign creation workflow.

See [workspace-components.md](workspace-components.md) for component ownership
and state coverage. Local verification is recorded in
[workspace-design.md](workspace-design.md).

The inbox AI summary now uses a visible glass gradient note beside the
reading column on wide screens and above it on smaller screens. The
decorative animated icon honors reduced motion; AI actions stay in the
existing tools disclosure. Details and local verification are recorded in
[workspace-design.md](workspace-design.md#floating-ai-conversation-note-2026-10-14).

Conversation controls now open in a dedicated Assistant/Follow-ups/Sales
sheet from a compact toolbar. The composer prioritizes writing and review
with labelled drafting/templates actions; advanced work no longer expands
above the reply field. See the messaging controls revision in the
[verification record](workspace-design.md).
