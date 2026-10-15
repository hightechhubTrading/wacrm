# Shared UI color system

Semantic colors convey meaning independently of the selected brand accent. Light and dark values live in `src/app/semantic-colors.css`; the TypeScript status/pricing contract lives in `src/lib/ui-colors.ts`.

| Color | Meaning | Examples |
| --- | --- | --- |
| Green | Completed, available, covered | Won/resolved, connected/online, included components, save |
| Blue | Information or work in progress | Sent/open/sending, linked records, charged extras, communication actions |
| Amber | Waiting or attention required | Pending/scheduled/expired, unsaved changes, validation warning |
| Red | Failure or removal | Failed/lost, field errors, delete |
| Purple | Optional proposal | Optional upgrades excluded from the quotation total |
| Gray | Neutral or inactive | Draft, archived, unknown statuses |

The selected brand accent remains for navigation, focus/selection and identity. User-defined tag/stage/chart colors remain categorical data and are not replaced with severity colors. Owner identity uses the brand color with its crown icon, rather than warning amber.

Use `Badge` variants `success`, `info`, `warning`, `optional`, `neutral`, and `destructive`. Use `Button` variants `success` for save/confirm, `info` for communication, `destructive` for removal, and the default accent for normal navigation/create. Inline delete actions can use `ui-danger-action`. Operational status displays should use `statusClasses(status)` rather than fixed Tailwind shades. `Alert` exposes success/info/warning/destructive variants. `ui-tone ui-tone-<meaning>` provides a readable foreground, tinted opaque surface and border.

Always retain text/icon cues; color must not be the only distinction. Text on tone surfaces and filled buttons is checked for at least 4.5:1 contrast in both modes. UI focus indicators remain visible, and forced-color mode retains a border. Adding a semantic state requires assigning its meaning in the shared contract; it must not follow a selected accent theme.

Applied to quotations and component pricing, inbox/presence/message status, pipeline outcomes, broadcast/recipient status, flow status and validation, settings/status chips, and shared errors/warnings/delete controls. Existing arbitrary chart, tag, stage and category colors remain separate from this semantic system.

## Area accents

Navigation icons and shared page marks provide a second, restrained layer for finding sections: blue for customer communication (inbox/contacts/broadcasts), cyan for sales/products (pipelines/catalog/future inventory), purple for quotation documents, amber for operations (automation/flows/jobs), and gray for settings/overview. `areaForPath()` is the single route-to-area mapping. Quotation step markers use blue for customer context, cyan for product pricing, and amber for commercial terms. These accents are limited to icons/markers; semantic state colors retain priority on badges and actions.
