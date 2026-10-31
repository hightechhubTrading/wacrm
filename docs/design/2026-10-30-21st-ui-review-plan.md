# 21st UI review and design improvement plan

30 October 2026 · Planning only · No application fixes or deployment performed.

## Recommendation

Make the CRM feel deliberately designed through stronger task hierarchy, readable density, and fewer nested surfaces. Keep the existing full-window workspace, Inter/Tajawal typography, saved accent choices, bilingual navigation, and customer-to-quotation workflows. Start with accessibility defects; prototype the visual changes separately.

The supplied references suggest useful principles: the course dashboard's clear navigation and content hierarchy, the dark CRM's grouped customer context and selective color, and the mobile examples' focused screens. Adapt those principles to sales work. Do not copy their tiny labels, decorative statistics, large promotional banner, tilted phone framing, or floating desktop mockup. The project's existing full-window requirement remains the baseline.

## Review method and limits

- Installed the requested skill pack once with `npx @21st-dev/cli install-skill`; applied `/Users/naderismail/.codex/skills/21st-ui-review/SKILL.md`.
- No 21st MCP tools were exposed in this session; the inspected Codex MCP configuration also had no matching entry. Used the 21st CLI successfully. This does not prove that another client has no 21st configuration.
- Read `AGENTS.md`, `docs/workspace-design.md`, `docs/design-system-rollout.md`, relevant components and styles. `.21st/design.json` is absent; the project documents provide the design context.
- Ran `npx @21st-dev/cli review src --json`: 692 files, 29 errors, 31 warnings, 302 suggestions. These are raw heuristic findings, not 362 confirmed defects. Exit code 1 accompanied the findings.
- Inspected the actual PipelineExplorer with synthetic data in Chrome at 390 and 1280px, English/Arabic, light/dark: eight combinations, no browser exceptions or positive document-width overflow. Checked rendered screenshots in both modes. Search rendered at 14px in all combinations.
- The temporary harness uses actual components/styles with mocked data and an Arial fallback, without the Next.js shell or production font loading. It establishes component observations, not full-app visual or accessibility conformance. Arabic phone captures show edge clipping despite the overflow check; reproduce in the actual shell before attributing this to production. Negative RTL overflow and clipping need bounding-box checks, not only `scrollWidth`.
- No authenticated production review, real-device keyboard check, full contrast audit, or complete route/state sweep was performed. Historical validation in project documents was not treated as fresh evidence. Existing uncommitted work and the earlier experience plan were preserved.

## High-confidence defects to fix in the implementation phase

| Priority | Finding and exact evidence | Why it matters | Planned fix and acceptance |
| --- | --- | --- | --- |
| P1 | Deal form labels are adjacent rather than associated: `src/components/pipelines/deal-form.tsx:307`, `:317`, `:344`, `:357`, `:373`. Inputs/selects lack matching IDs and label references. `src/components/ui/label.tsx:9` renders a plain label. | Screen-reader users cannot reliably identify fields; clicking a visible label does not focus its control. Placeholder/selected option text is not a stable field label. | Use unique IDs and `htmlFor` for every field, with descriptions/errors linked where relevant. Verify names in the accessibility tree, label-click focus, and keyboard completion in English/Arabic. Preserve validation and payloads. |
| P1 | Color-option buttons have no names or programmatic selected state: `src/components/pipelines/pipeline-settings.tsx:675–689`. The trigger is 16px at `:667`; options are 20px at `:683`. The custom dismissal overlay at `:673` has no Escape handler in this component. | Users cannot distinguish colors through assistive technology; small controls are difficult on phones; dismissal behavior is inconsistent. | Reuse the existing accessible popover primitive. Add localized option names, selected state, trigger expanded state, Escape/focus return, and larger hit areas. Retain a small visual swatch inside the target. Confirm target spacing and all keyboard paths in both themes. |
| P1 | Reduced-motion rules explicitly exclude the dashboard: `src/app/globals.css:342–348` and `src/app/design-system.css:517–524`. Workday decorations loop indefinitely at `src/components/dashboard/workday-widget.module.css:50`, `:79`, `:119–125`, `:239–246`; the component has no reduced-motion guard. | A user's motion preference does not stop these nonessential effects, contrary to the documented project direction. | Provide static reduced-motion states for dashboard decoration and avoid starting unnecessary animation synchronization. Retain useful information. Verify computed animations and visual stability with the preference on/off; review pause behavior for persistent decorative motion. |
| P2 | Hardcoded English remains in Arabic UI paths: `src/app/(dashboard)/dashboard-shell.tsx:44` (“Loading...”), `src/components/layout/sidebar.tsx:221` (“Primary”), and `src/components/flows/header.tsx:67–81`, `:169–170`. | Arabic users receive inconsistent visible and assistive labels, particularly during navigation and editing. | Move these strings into existing English/Arabic catalogs without changing routes or behavior. Verify loading, landmarks, and editor field names in both locales. |

These are proposed fixes only. Do not run blanket `--fix` or change brand/product behavior as part of this tranche.

## Design drift and responsive risks

| Priority | Evidence | Assessment and next step |
| --- | --- | --- |
| P2 | Dashboard comparison text is 9px at `src/components/dashboard/dashboard-design.module.css:183`; metric labels are 11px at `:128`, secondary figures 10px at `:151`. The design brief specifies 12px metadata and 14px body/controls. | Confirmed drift from the project's type scale, not by itself a WCAG failure. Restore readable metadata before increasing whitespace. Validate real Inter/Tajawal rendering, long labels and 200% zoom. |
| P2 | `src/app/design-system.css:137–147` forces inputs/select triggers/textareas to 14px. The pipeline search computed to 14px at 390px in both modes/locales. | Mobile editing risk, including potential iOS focus zoom. Plan a 16px mobile editable-field variant while keeping compact desktop controls. Verify on iOS and Android; desktop Chrome cannot prove keyboard behavior. |
| P2 | Pipeline cards repeat a glass AI-summary container even without a saved summary: `src/components/pipelines/deal-card.tsx:290–307`; styling at `src/app/design-system.css:953–967`. Both theme captures show it competing with owner attention. | Confirmed composition, subjective severity. Prototype a compact empty-summary treatment; show the richer summary only when it conveys useful content. Preserve unavailable/loading distinctions and discovery of the action. |
| P2 | Pipeline actions share equal size and colored treatments at `src/app/design-system.css:977–986`. | A generic repeated action strip weakens the next-action hierarchy. Prototype one contextual primary action with secondary actions in a consistent menu. Which action leads is a product decision. |
| P2 | Arabic mobile component captures show right-edge clipping despite a passing document-width check. | Fixture-level observation only. Repeat inside the actual shell with production fonts. Inspect negative element coordinates, sticky regions, local scrolling and long Arabic labels before changing CSS. |

## Judgement calls for the user

Recommended starting direction: a quiet operational workspace with neutral surfaces, selective status color, and visibly different compositions for conversation, table, board and document tasks.

1. **AI emphasis:** recommend flattening repeated empty AI-summary panels and making useful summaries more prominent than their branding. Existing notes describe glass AI cards as a previous user request; removing that treatment requires a deliberate design decision.
2. **Dashboard personality:** recommend keeping Agenda dominant and reducing the visual weight of decorative workday/weather widgets. Whether to retain mascots, glow, and clock animation under normal motion settings is a preference, separate from honoring reduced motion.
3. **Navigation:** compare the current 72px rail with an optionally expanded labeled rail. Preserve routes and permissions. Do not rename Contacts/Pipelines or reorganize modules without evaluating staff workflows.
4. **Pipeline density:** compare the current detailed board against compact cards showing customer, deal/value, owner, next action and due date, with details in the inspector. Keep keyboard stage movement and existing board/list/tag views. Decide using find-and-act task performance.
5. **Accent treatment:** keep six saved accents initially. Prototype quieter use of the active accent for selection and primary action; preserve semantic warning/success colors. The screenshots' purple, pastel and yellow palettes are inspiration, not a mandate for a new brand.

## Implementation sequence

1. **Establish the baseline.** Capture the real shell and main workflows before edits: Dashboard, Inbox, Pipelines/deal editor, Contacts, Quotations, and Settings; sample Broadcasts/Flows where review findings apply. Record populated, loading, empty, error and read-only states. Reconcile active local edits before working in shared files.
2. **Fix deterministic issues.** Associate labels, repair swatch semantics/interaction, honor reduced motion, and translate the identified strings. Use existing Base UI primitives. Review remaining CLI candidates against rendered behavior; reject false positives explicitly.
3. **Repair measured visual defects.** Fix verified clipping, contrast/focus failures and mobile input behavior. Bring essential metadata back into the documented type scale. Centralize the smallest necessary token/density changes and check portaled dialogs independently of the shell.
4. **Prototype the chosen visual direction.** Use one pipeline board and one dashboard as representative screens, with realistic synthetic data. Compare hierarchy, card density, AI emphasis and navigation in both themes before extending to other modules. Use 21st catalog patterns only when they fit existing primitives and tokens; do not import an unrelated template wholesale.
5. **Roll out and verify.** Apply agreed patterns to tables, inspectors, quotations and contextual tools. Preserve message ownership, physical message sides, URLs, permissions, payloads and draft/send work currently in progress.

Each step produces a reviewable diff and before/after captures. Steps 1–3 address evidence-backed defects; step 4 requires choices on the recommendations above. Estimate implementation after the full-shell baseline, rather than treating raw CLI counts as effort estimates.

## Completion gates for future implementation

- Both light and dark, English and Arabic, 360/390/768/1280/1440px; one wide-desktop check at 2560px. Test all six accents on shared controls and semantic status treatments.
- Actual Inter/Tajawal fonts; long names, phone numbers, QAR amounts, multiline Arabic and 200% text zoom. Check reflow at an effective 320px viewport where applicable.
- Keyboard-only navigation, visible focus, meaningful accessible names, modal isolation, Escape and focus return; no hover-only essential actions. Evaluate target size and spacing, with comfortably sized primary phone controls.
- Measure rendered text contrast and essential control/focus contrast in actual states, including disabled/loading and portal surfaces. Do not infer conformance from token hex values alone.
- Reduced motion produces stable decoration. Normal motion remains purposeful and does not obstruct work.
- Loading, empty, unavailable, failed, retry and read-only states remain distinguishable. Confirm safe draft/send behavior and deep links after UI edits without sending real customer messages.
- Re-run `21st review`, triage remaining findings, run focused interaction tests and project type/build checks appropriate to the changed code. Record the final matrix and unresolved issues before calling the implementation done.

## Evidence and rejected scanner claims

Evidence is stored in `2026-10-30-21st-evidence/`: raw CLI JSON, synthetic browser measurements, four representative screenshots, and the temporary harness source for provenance. It uses an absolute workspace path and is an audit artifact, not a new project test runner.

Examples of scanner findings not accepted as defects: `src/app/api/whatsapp/webhook/route.ts:1304` is a comment containing `<img>`, not an inaccessible image; color definitions in `design-system.css` are intentional tokens; `deal-form.tsx:321` already supplies a focus border/ring, and `flows/header.tsx:82` supplies focus border/shadow. Focus appearance still needs visual measurement, but `outline-none` alone is insufficient evidence of failure.
