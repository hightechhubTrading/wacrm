# Quotation design audit — 2026-10-14

## Findings corrected

- Product headings lost their disclosure cue during density reduction. An explicit chevron now indicates expansion without competing with duplicate/delete actions.
- Expanded document review used a fixed panel with no focus containment. Base UI Dialog now provides a named modal, initial close-button focus, contained keyboard navigation, Escape behavior and focus return. Nested zoom menus can close with Escape without closing the review.
- Quotation “sent” and “won” both inherited the brand accent, changing meaning when users selected a theme. Sent/in-progress is now informational blue, won/complete is green, lost is red, expired is amber and drafts are neutral.
- Component pricing was differentiated mainly by prose. Included, extra and optional now have green/blue/purple labels, selected menu treatments and borders; text labels remain visible.
- Delete controls resembled ordinary edits. They now use the shared danger color; duplication is informational and save/communication actions use stable semantic colors.
- Operational error/warning colors used pale fixed Tailwind shades in light mode. Shared mode-aware tokens now cover feedback in settings, forms, inbox, broadcasts, flow validation and pipeline controls.
- The pipeline quotation dialog displayed untranslated statuses. It now uses the existing quotation status translations while retaining canonical status attributes for styling.
- Export/save errors could appear above a scrolled editor without receiving focus. The error banner now receives focus and clears the sticky header.

## Shared design contract

See [UI color system](ui-color-system.md). Palette values live centrally, do not follow brand accent changes, retain textual/icon cues, and expose reusable status classes and Badge/Button/Alert variants. Categorical tag/stage/chart colors remain independent data.

## Verification

Automated browser checks cover tone foreground/background and filled-button contrast across six themes in light and dark modes, quotation pricing labels, nested review/zoom keyboard behavior, focus return, and widths 320–1600 px. Quotation calculations, duplication/deletion/undo, stored snapshots and actual PDF output remain covered by their existing checks. Static review covers the additional UI modules migrated to the palette; full production navigation through every legacy screen is outside these browser checks.
