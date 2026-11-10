# Inbox responsive-layout fix plan

Status: implemented and deployed; automated production verification passed in Chrome and WebKit. Staff-device confirmation remains a manual follow-up.

## Outcome

Make the inbox usable at the browser sizes seen on staff Windows computers. Messages and the reply composer should remain the main working area. AI assistance, follow-ups and customer details must remain easy to open without squeezing the conversation into a narrow scrolling strip.

This is a shared layout correction. Keep existing permissions and each user's saved theme. No database migration, AI behaviour change or environment change is required.

## Confirmed evidence

The 10 November investigation used the current application with synthetic conversation data and compared owner/admin roles at identical browser sizes and appearance settings. Both roles produced identical geometry after loading completed.

| Usable browser viewport | AI note                                 | Message reading area |
| ----------------------- | --------------------------------------- | -------------------- |
| 1536 × 730              | 90px high, with 203px of content inside | 155px high           |
| 1920 × 950              | 220px-wide side card, 271px high        | 477px high           |

At the smaller viewport, the follow-up preview consumed another 141px and the composer consumed 151px. The header was 92px; real long names and assignments can make it wrap further. These are local reproduction measurements, not measurements taken from Saad's computer.

Relevant causes:

- `src/app/inbox-workspace.css:2204` limits the inline AI note to `min(200px, 35%)` of the remaining transcript height, while the note itself scrolls. At a transcript width of 1000px, a container query switches it to an absolutely positioned side card.
- `src/app/inbox-workspace.css:2091` gives the follow-up preview its own multi-line block, including when there are no active tasks.
- The header, reply toolbar and composer consume additional fixed vertical space. The current layout responds mainly to width, with insufficient accommodation for short desktop windows.
- Appearance is a separate issue: the live profiles have Rose / Light for Nader and Navy & Gold / Dark for Saad. Their saved preferences explain the colour difference across browsers.

## Proposed behaviour

### 1. Keep secondary information compact when space is limited

Use available width and height, never account role or browser identity, to choose the layout. Start with compact treatment below 820px of usable browser height or below 1000px of conversation-panel width; calibrate these thresholds against the acceptance matrix before release.

In compact mode:

- Replace the full inline AI card with a short summary control. Keep AI ownership/paused state and any urgent handoff indication visible. Open the full note, sales guidance and existing controls in the conversation tools sheet.
- Show follow-up count and the nearest due/overdue task in a compact row. With no active tasks, use a single short row. Keep adding and managing follow-ups available through the existing sheet.
- Keep loading, unavailable and empty states distinguishable. An unavailable follow-up service must not appear as “0 tasks.”
- Opening details must not reduce the message viewport further. Use the sheet's own scrolling region, with keyboard dismissal and focus return.

On a large viewport, retain an expanded AI view where it genuinely fits. Prefer an explicit grid/flex column over an absolute card so it cannot overlap messages. Keep a minimum readable message-column width; use the compact control when that cannot be maintained.

### 2. Fit the header and side panels to the window

- Reduce oversized desktop header padding. Allow a deliberate two-row arrangement for long customer names, status and assignment controls; do not let incidental wrapping keep growing the header.
- Keep the full customer name available through accessible text/details when the visible name is truncated.
- At narrower desktop widths, initially 1024–1399px, open customer details in the existing sheet instead of reserving a third column. Keep the details toggle visible and labelled. Reuse the existing contact-panel content and message navigation.
- Preserve the user's stored show/hide preference for larger desktops. Responsive hiding must not overwrite that preference or cause the panel to reopen repeatedly during resizing.
- Preserve the existing single-pane navigation below 1024px, including returning from a conversation to the list.

### 3. Make the composer compact without hiding essential actions

- Reduce idle padding and redundant helper spacing. Keep the text field, Send, AI draft action and essential attachment access visible.
- Place secondary actions in an accessible overflow menu only where they no longer fit. Preserve access to templates, product files, translation and recording.
- Let multiline text grow to a bounded height, then scroll within the text field. Preserve drafts and caret position when resizing or opening panels.
- Verify reply-to previews, attachment previews, recording, send failures and the expired WhatsApp-session state. These must remain reachable without overlapping the last message or hiding Send.
- Keep readable typography and usable hit targets. Do not solve the problem by shrinking the entire interface or prescribing a smaller browser zoom.

## Implementation sequence and files

1. **Capture a stable baseline.** Promote the temporary reproduction into a focused browser check using `scripts/performance/supabase-fixture.mjs`. Wait for messages, follow-ups and AI state to settle before measuring. Record small and large desktop screenshots and bounds for all working areas.
2. **Implement compact assistance and follow-ups.** Update `src/components/inbox/message-thread.tsx`, `ai-thread-banner.tsx` and `ai-followups.tsx`. The existing Assistant tab currently contains controls rather than the full conversation note: add the full note/guidance there before removing the inline content in compact mode. Reuse loaded state and avoid duplicate requests or duplicate element IDs from mounting two active copies.
3. **Adjust layout and contact-panel presentation.** Update `src/app/inbox-workspace.css` and the composition in `src/app/(dashboard)/inbox/page.tsx` / `message-thread.tsx`. Consolidate conflicting rules for the touched components rather than appending more overrides. Reuse the existing tools/contact sheets.
4. **Compact the composer.** Update `src/components/inbox/message-composer.tsx` and its inbox styles, preserving existing send and draft behaviour.
5. **Add labels and regression checks.** Update the existing Inbox namespaces in `messages/en.json` and `messages/ar.json`. Test keyboard/focus behaviour, panel state across resize, and the geometry targets below. Re-run the deterministic UI review on changed components.
6. **Build, deploy and verify.** After the checks pass, use the existing resource-limited VPS updater, candidate preflight and rollback mechanism. Verify the deployed revision and public routes, then compare the same conversation on a staff Windows computer and the owner's computer.

## Acceptance criteria

These targets apply to the normal idle composer with an active conversation, follow-up state loaded and no large attachment preview. Test exceptional states separately for accessibility and overlap.

| Viewport / condition                | Required result                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1536 × 730                          | At least 320px of visible message reading area, compared with the 155px baseline                        |
| 1366 × 650                          | At least 260px of message reading area; details available through the sheet                             |
| 1280 × 600                          | At least 220px of message reading area; all primary reply actions reachable                             |
| 1920 × 950                          | At least 450px of message reading area; expanded assistance can fit without overlap                     |
| 390 × 844 and 768 × 1024            | Single-pane navigation works; no horizontal page overflow or inaccessible controls                      |
| Short viewport / on-screen keyboard | Composer remains reachable; secondary information collapses instead of forcing a desktop minimum height |

Across the matrix:

- No tiny independently scrolling AI preview. Full notes remain readable in the expanded panel.
- Each main pane has a clear scrolling area. The transcript is not covered by an AI card, toolbar or composer.
- Customer identity, ownership state, overdue follow-ups and connection/error notices remain discoverable and readable.
- Long English/Arabic names, multiple overdue tasks, long summaries and a wrapped draft do not cause overlap or remove essential controls.
- Owner and admin produce the same layout for the same data and appearance. Agent/viewer controls still follow existing permissions.
- Switching conversations or resizing preserves drafts, contact-panel preferences and sensible message scroll position.
- Sheets support Tab, Escape, labelled controls and focus return to their trigger or the composer as appropriate.

## Verification matrix

- Run the geometry checks at every size above, plus boundary sizes immediately before and after each chosen breakpoint.
- Compare owner/admin with the same theme first. Then compare light/dark mode and Rose/Navy & Gold; spot-check the other existing accents for contrast and control visibility.
- Cover English LTR and Arabic RTL, short/long names, empty/active/overdue follow-ups, AI paused/active/unavailable, and contact details open/closed.
- Exercise multiline drafts, attachments, templates, AI drafting, recording and send-error recovery against fixtures. Do not send real WhatsApp messages as a layout test.
- Verify Chrome and another supported desktop browser. Include 100%, 125%, 150% and 200% browser zoom. Test Windows display scaling separately on an actual Windows machine; device pixel ratio emulation alone does not reproduce OS scaling.
- Run type checks, lint on changed files, focused interaction tests and the production build. Verify header/composer bounds as well as document width: a page can have no horizontal overflow and still contain badly clipped controls.

## Rollout and completion

Ship this as one focused layout release after the targets pass. Preserve the previous image for rollback and verify the exact running revision after deployment. Confirm one small-window staff session and one larger-window owner session using the same conversation and matched appearance settings, then let each user retain their preferred theme.

The fix is complete when staff can read messages and reply comfortably at the tested smaller viewports, all secondary information remains accessible, and role changes do not alter layout geometry. Matching everyone's theme is not required for this result.

## Implementation verification — 10 November 2026

Implemented the compact assistance/follow-up controls, full note in the existing Assistant sheet, reserved AI grid column on roomy desktops, contact drawer below 1400px, and a composer with text/Send on one row and reply tools below it. The hook measures the real conversation width and available viewport height. Very short viewports keep assistance and follow-ups accessible through the reply toolbar. Saved contact-panel preferences are not rewritten by responsive changes.

Chrome production-build results with representative long customer names:

| Viewport   | Previous message height | Implemented message height | Target |
| ---------- | ----------------------- | -------------------------- | ------ |
| 1536 × 730 | 155px                   | 403px                      | 320px  |
| 1366 × 650 | —                       | 322px                      | 260px  |
| 1280 × 600 | —                       | 272px                      | 220px  |
| 1920 × 950 | 477px                   | 642.5px                    | 450px  |

The regression script checks 90 viewport/role/language/theme combinations, including exact breakpoint boundaries, single-pane tablet/phone navigation and short viewports. Owner/admin geometry matches. It also checks note access and focus return, preservation of drafts and contact preferences across resize, overdue/unavailable/failed follow-up states, bounded multiline drafts, prepared-reply insertion/focus, failed-send draft recovery, attachment preview/removal and expired-session template access. Network writes for draft generation, media storage and sending are intercepted with fixtures; no real messages are sent.

Reproduce the production checks with:

```sh
INBOX_TEST_PRODUCTION=1 INBOX_TEST_BACKEND_PORT=48123 node scripts/check-inbox-responsive.mjs
```

The default output directory is `/tmp/wacrm-inbox-responsive`, with geometry JSON, screenshots and the build/server log. `INBOX_TEST_BROWSER=webkit` selects the second browser engine. A subsequent run may reuse the production build with `INBOX_TEST_SKIP_BUILD=1` and the same backend port.

Focused inbox/composer/i18n tests: 92 passed. Type checks pass. The changed composer passes deterministic UI review with no findings; existing unrelated review warnings and the contact-image lint warning are outside this change.

Actual Windows display scaling, physical mobile keyboards and a side-by-side staff-device comparison still require device confirmation. The viewport tests cover the resulting constrained layout sizes; they do not claim to reproduce OS scaling or physical keyboards.

Cross-browser refinement: sheets explicitly remember the control that opened them; preparing a reply gives final focus to the composer. Native media-query changes drive height thresholds, with visual viewport measurements reserved for an active touch keyboard. The regression waits for React to apply each resize before measuring. WebKit reports some deliberately canceled cross-origin fixture requests as native fetch errors during document teardown; the harness records these separately and still fails on application errors and uncanceled steady-state failures.

## Release verification

Application revision `8c219d1bf8ca19e245253447470699144423211e` is deployed at `https://wacrm.srv1795091.hstgr.cloud`. The updater completed its production build, database preflight, candidate checks, promotion and public-route checks. The running revision was verified. The previous image remains available as `wacrm:rollback`.

The final fixture-backed production build passed 90 cases in Chrome and 90 in WebKit, with matching representative owner/admin geometry, including all planned desktop height targets. The refined focus handling passed both the AI-sheet return and prepared-reply composer checks. All recorded non-canceled steady-state application errors fail the browser regression. The fixture tests wait for the relevant UI and resize state rather than generic network-idle, since permission-denied viewers can keep background polling active.

No staff password, theme, role, company data or live WhatsApp message was changed by this layout release. Ask staff to refresh the inbox and compare the same conversation on their actual Windows display. This confirms device scaling that the automated viewport matrix cannot establish.
