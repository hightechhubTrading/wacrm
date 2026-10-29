# Phone-first operations: implementation plan

29 October 2026 · Planning only. Companion to [the product direction and to-do](phone-first-operations-todo.md).

## Progress, 29 October 2026

The first local implementation slice improves the existing handoff: distinct preparation/report entry from inbox, touch-friendly request/action choices, optional responsible-person disclosure, share/copy support, full-width phone layout, evidence hints and duplicate-active-request guidance. Details and browser-check instructions are in [group-work.md](group-work.md).

This slice uses existing API contracts and server state rules. Discovery with staff, actual-device validation, platform choice, employee assignment, assisted preparation and broader operations remain open. No production rollout is implied. Do not mark discovery or usability validation complete based on synthetic browser checks.

The subsequent sales-only Today view is now implemented locally in the dashboard: customer replies, due/overdue follow-ups, blocked jobs and recorded measurement/workshop work, with direct actions. [Sales Today](sales-today.md) records scope, tests and the new read-only migration 082 required before deployment. The user clarified that only a few salespeople currently use the app, so worker onboarding, worker-specific work lists and native app selection remain later phases. Staff and physical-device validation are still open.

## Outcome

Make a customer request easier to coordinate across sales and workers using familiar phone interactions, while preserving existing WhatsApp habits. Start with the measurement handoff, learn from actual users, then extend the pattern. Arabic and English and both Android and iPhone are first-class requirements. Natural language, photos and voice supplement straightforward buttons, date pickers and short forms.

## Starting point and constraints

- The inbox shows selected deal context, visit/report/workshop shortcuts and next actions (`src/components/inbox/sales-workspace.tsx`). Both visit and report currently open the same measurement sheet.
- The handoff UI (`src/components/jobs/group-work.tsx`) creates measurement/workshop requests and copies text for WhatsApp. A person records posting and forwarded reports; the app does not see existing group activity. The waiting queue is on Pipelines.
- `src/app/api/jobs/[dealId]/route.ts`, `src/lib/jobs/workflow.ts` and migration 070 enforce deal-scoped access, state transitions, evidence, revision checks and an accepted-quotation snapshot for workshop orders. The responsible field is free text, not an account assignment. One active handoff per deal and kind is allowed.
- The existing inbox sales assistance can prepare a checked summary and next action from supported sources; its runtime activation and deployment must be checked separately. Dashboard agenda is primarily sales-oriented.
- Local code and documentation are the basis for this plan. Actual device usage, production state, account eligibility and staff preferences remain to be verified.

## Phase 0 — Observe and define the first flow

1. Trace 3–5 recent measurement jobs with sales and workers, including an interrupted or delayed one. Record steps, information available at each step, languages, phone models, connectivity, handoff channels and who makes decisions. Do not copy private customer data into design fixtures.
2. Map the current flow and agree on one small pilot: customer request → prepare measurement → share → worker response → sales records report. Identify which details are essential and which can arrive later.
3. Baseline completion time, number of manual handoffs and follow-up messages, missing details and failure points. Use a small sample as directional evidence, not statistical proof.
4. Verify current official WhatsApp group capabilities and account eligibility. Identify a practical fallback using copy/share/forward; no group-reading assumption.

**Exit:** a signed-off example flow, actual device/language list, baseline and a list of open questions. If real staff are unavailable, use a clearly marked synthetic flow and retain staff testing as a release gate.

## Phase 1 — Prototype and test on phones

1. Create a small interactive prototype of sales creating a measurement request, sharing it, recording a response, and viewing the next action. Offer a date picker and short typed note; show optional photo/voice inputs only when the chosen platform can support them.
2. Use known customer/job information where available and show missing details progressively. An early request and a confirmed commitment must look different. Keep the original conversation accessible.
3. Test with at least one salesperson, worker and manager using representative Android and iOS devices, in their preferred language. Ask each to complete the flow without coaching, including a blocked or changed-date scenario.
4. Revise wording and steps based on observed confusion and compare against the baseline. Decide web/mobile-web versus a shared or separate native app only after testing camera, share, notifications, authentication and connectivity needs.

**Exit:** a tested flow with documented issues and a platform decision for the first implementation. No assumption that a prototype proves WhatsApp integration or production readiness.

## Phase 2 — Improve the existing measurement handoff

1. Give inbox shortcuts explicit destinations: **Request visit** opens preparation; **Add report** opens the appropriate existing measurement work and report action. If there is no matching work or several possible records, show an honest choice or next step.
2. Replace the single long request form with a compact, mobile-friendly task flow. Prefill only verified existing values, allow edits and disclose missing requirements. Start by maintaining the existing API contract; change validation/schema only when observations justify it and migration compatibility is planned.
3. Present applicable actions as clear buttons based on `src/lib/jobs/workflow.ts`; preserve allowed transitions and evidence checks. Show who recorded a forwarded report, rather than suggesting the worker submitted it directly.
4. Offer device sharing when supported and a copy fallback. Sharing or copying must not automatically record a successful WhatsApp post; keep explicit confirmation. Make the draft, waiting, blocked and completed states understandable.
5. Make attachment capture easy using supported device inputs and existing private storage, file limits and authorization. Evaluate direct recording separately; do not promise a native recorder until tested.
6. Keep workshop order protections, including accepted quotation snapshot, intact. A future feasibility inquiry must be a distinct, explicitly designed request, not a workaround that bypasses authorization.

**Exit:** usable end-to-end measurement flow on small Android and iPhone screens, bilingual, with no regression to existing handoffs or access controls. Pilot using synthetic data before any real operational rollout.

## Phase 3 — Focused work and real assignments

1. Improve the existing agenda and waiting queue into a task-oriented **Today** view for sales: needs action, waiting for a response, blocked and due soon. Show only information supported by recorded events.
2. Design worker identity and assignment with the actual organization: account membership, access limited to authorized jobs, invite/revoke, attribution and manager visibility. Keep free-text labels available for people who do not use the app; do not treat a label as a user ID.
3. After access design and real-device validation, add a worker-facing task view and direct updates. Existing forwarded reports remain available for colleagues who stay in WhatsApp. Introduce notifications only once device registration, delivery, preferences and access revocation are designed.
4. Define conflict/retry handling before allowing offline mutations; use safe retries, clear pending state and no false success. Stock updates need separate transactional rules before inventory is introduced.

**Exit:** assigned people can see and update only authorized work; managers can distinguish direct worker updates from information relayed by sales. Confirm behavior with multiple organizations and roles.

## Phase 4 — Assisted preparation

1. Reuse existing checked sales-assistance context where appropriate. Propose editable request fields using supported customer messages, showing their sources and leaving unsupported or uncertain values blank.
2. Keep suggestions optional and require explicit user confirmation before creating a request or making a customer commitment. Handle stale messages, changed deals, provider failures and disabled assistance without blocking the manual flow.
3. Evaluate representative bilingual, mixed-language and voice-transcription examples; check correctness and usefulness, not just acceptance of model output. Do not claim images or attachments were understood unless the implementation actually processed them.

**Exit:** the manual path works independently; suggestions are traceable, reviewable and evaluated. Consult the project’s AI-workflow instructions and relevant existing integration documentation before implementation.

## Phase 5 — Extend and prepare for a product

1. Repeat the workflow exercise for workshop, warehouse and delivery, prioritizing the highest-friction actual handoff. Distinguish feasibility, confirmed production, stock availability and delivery completion. Design inventory as recorded stock movements before exposing balances as authoritative.
2. Review tenant isolation across UI, APIs, storage, background jobs and notifications; test cross-company denial. Add configurable terminology and workflow options only when validated by more than one customer.
3. Pilot onboarding, role setup, import/export and support with a small number of similar companies before deciding packages and pricing. Retain a simple modular application until usage justifies additional infrastructure.

## Validation and rollout for each implemented slice

- Trace UI → API → business rules → database/RLS; preserve existing event history, stale-revision handling and attachment privacy. Add migrations only if necessary and plan deployment ordering and rollback.
- Run focused workflow/API tests, authorization and cross-account tests where data access changes, translation parity and TypeScript; run repository checks appropriate to the change. Use synthetic fixtures for browser checks.
- Test small-screen Arabic/English, touch targets, camera/share behavior, slow connection, reload, denied permissions, failed upload and repeated taps. Test on actual Android and iOS devices before employee rollout.
- Release behind an account-scoped switch where appropriate, pilot with a small team, record errors and feedback, and keep a way back to the existing flow. Verify deployment and migrations independently; never equate a local pass with production readiness.
- Compare time to create/respond, handoff completion, missed details and staff feedback with the baseline. Review whether the workflow saves effort or merely moves it between people.

## Immediate implementation order

1. Observe real measurement requests and verify current deployment/WhatsApp constraints.
2. Prototype and test the phone flow.
3. Implement direct inbox entry and the simplified measurement handoff using existing state rules.
4. Pilot the sales-focused Today view; design worker access before worker-specific rollout.
5. Add optional assisted preparation after the manual flow is proven, then extend into the next real operational workflow.

## Sales release authorization, 29 October 2026

The user authorized applying migration 082, committing, pushing and deploying the sales changes. Migration 082 is applied as `20261029100117`, with live authorized/tenant/permission checks passed. The scoped release is validated in an isolated checkout; see [Sales Today](sales-today.md) for evidence and deployment requirements. Staff usability and physical-device testing remain open.
