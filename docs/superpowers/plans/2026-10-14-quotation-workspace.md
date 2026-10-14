# Quotation workspace plan

Date: 2026-10-14
Status: proposed; no application changes made.

## Direction

Build a focused sales document workspace inside the existing CRM shell. Adapt the references' grouped fields, editable item table, visible totals and side-by-side document review. Use the CRM's existing typography, surfaces, navigation, themes and Arabic support. Keep the approved HTH document identity for customer-facing PDFs.

The examples show invoice and receipt workflows. Our page remains a quotation: validity, scope, delivery, payment and warranty matter; receipt categorization and invoice due-date controls do not belong here. Tax controls remain outside this release, consistent with the existing quotation specification.

## Current implementation and gaps

Verified against the local code, not production:

- List supports status filtering, standalone creation and account-managed product codes. It needs search, fuller context and expiry filtering.
- Detail page stacks customer form, PDF actions and item editor. Customer fields and items have independent save actions.
- Items support catalog selection, free text, accessories/customizations and line/order discounts. Dimensions and section types exist in the data model but are not fully exposed as a practical editor workflow.
- Shared totals calculation exists in the browser/server. Dimensions are descriptive; pricing currently uses quantity × unit price.
- Delivery/payment/warranty fields exist in migration 059, but are missing from the shared Quotation mapper, form and PATCH allowlist. The PDF builder does not populate configurable terms/payment schedules.
- PDF generation exists, but no live document review is integrated into the editor.
- The send route resolves a conversation and returns a PDF URL. The action opens the inbox; it does not stage the attachment or confirm transport success. Status is currently changed manually.
- PATCH saves items and fields sequentially; combining those into one request alone would not make the whole quotation save atomic.

Primary ownership: `src/app/(dashboard)/quotations/[id]/page.tsx`, `src/components/quotations/`, `src/lib/quotations/`, quotation API routes, migrations 059–062 and the existing inbox composer/send path.

## Layout

Wide desktop uses an editor on the left (roughly 60%) and a collapsible document preview on the right (roughly 40%). Keep the item editor wide enough for meaningful descriptions; below approximately 1280px, use Edit / Preview views instead of squeezing both columns. Test the final breakpoint against the actual CRM rail and usable width.

```text
CRM navigation | Back · Reference · Status · Revision
               | Saved / Unsaved changes    Save draft · Preview · Prepare WhatsApp
               |---------------------------------------------------------------
               | Customer & project       | HTH document preview
               | Quotation details        | Page navigation · Zoom · Expand
               | Products & services      |
               | Commercial terms        | Same content as exported PDF
               | Internal context         |
               |---------------------------------------------------------------
               | Subtotal · Discount · Total QAR
```

Use a sticky compact action header and clear section dividers. Avoid wrapping every input group in separate nested cards. Preview uses paper styling; editor follows the app theme. Mobile uses one column, item summaries with expandable editing, a full-screen preview and a compact sticky save action that does not hide fields or validation.

## Page contents

| Area | Controls and behavior |
|---|---|
| Customer & project | Search/select contact, or enter a standalone customer. Name, WhatsApp number, company, project and location. Link a deal. Selecting a contact proposes values; existing quotation snapshot values are not silently replaced. |
| Quotation details | Read-only generated reference and revision, subject, issue date display, editable valid-until date and preset validity durations. Currency defaults from account configuration. Keep QAR document support explicit until renderer/amount-in-words support other currencies. |
| Products & services | Add catalog product or custom line; add section; quantity, unit price, computed line total. Expand for code, Arabic description, width/height with explicit measurement units, discount and accessories/customizations. Duplicate, remove with undo, reorder with keyboard-accessible controls. |
| Discounts & totals | Reveal discount controls when needed. Support line and whole-quotation percentage/fixed discounts; display their effects clearly. Server recomputes totals. Zero-priced lines must be explicit; incomplete prices must not silently become a ready-to-send zero quote. |
| Commercial terms | Delivery, payment and warranty text using editable account defaults copied into the quotation. Add structured payment milestones only once their percentages/amounts can be stored, validated and rendered consistently. |
| Internal context | Linked contact/deal and assignment. Clearly distinguish CRM context from customer-visible document content. Internal notes require a separate persisted field if added; exclude them from the PDF. |
| Preview | Live draft preview with the actual branded template and matching calculation. Draft edits are visibly marked unsaved. Paginated export review must verify long rows, many items and Arabic content. |

The list becomes the entry point for finding and resuming work: search reference/customer/company/project, status filters including expired, and columns for reference, customer/project, status, total, validity and last updated. New quotation can start from the list, contact, deal or inbox context; all entry points share the same editor.

## Workflow and state rules

1. Create a draft, optionally prefilled from a contact/deal. Preserve server-generated collision-safe references and assignment visibility.
2. Edit customer, scope, items and terms in one client draft state. Show live totals and draft preview immediately. First release uses one explicit Save draft action; show saving, saved and retryable failure states, and protect navigation with unsaved edits.
3. Save the entire editable quotation atomically. Add version checking so concurrent staff changes produce a recoverable conflict rather than silently overwriting each other.
4. Preview/export first saves the current draft successfully, then generates from that exact persisted version. Block export on invalid customer-visible data and show errors beside the relevant fields.
5. Track whether the generated PDF matches the saved content. Editing saved content makes the prior PDF stale; preparation for WhatsApp regenerates it. Preserve previously sent PDF snapshots and revisions.
6. Prepare WhatsApp opens the correct conversation with the current PDF and editable caption staged in the composer. The salesperson reviews and clicks Send there. Confirm successful transport before updating the quotation to Sent; opening the inbox or generating a PDF must not mark it sent. Preserve draft attachment context if sending fails.
7. Sent quotations default to read-only review. Revise creates a new editable revision while preserving the previous sent document. Won/lost are explicit sales outcomes; they do not automatically create jobs or move pipeline stages in this release.
8. An overdue valid-until date displays an expiry warning. Define expiry transition and manual outcome behavior centrally; existing won/lost quotations must not become expired due to a date check.

Recommended export requirements: customer name/company, meaningful subject, at least one valid priced line, validity, and completed required commercial terms. Phone is required specifically for WhatsApp preparation, not for downloading a standalone quotation. Validate finite nonnegative amounts, positive quantities, percentage discounts within 0–100 and fixed discounts that do not exceed their applicable amount.

## Delivery sequence

### 1. Editor foundation

Read relevant installed Next.js guides before implementation. Consolidate draft state and saving; extend types/API mapping for existing term fields; add whole-document atomic persistence and conflict detection. Preserve authorization, account scoping, reference generation and existing item IDs/tree relationships. Inspect linked database schema before preparing additive migrations.

### 2. Workspace layout and practical editing

Implement the action header, grouped customer/details fields, compact product table, expandable accessories/dimensions/discounts, section controls, terms and persistent totals. Add contact/deal linking and list search. Translate all controls into English/Arabic with RTL layout, logical spacing and tabular monetary figures. Match existing CRM tokens and components.

### 3. Document review and reliable export

Use one renderer/data contract for preview and export. Populate configurable terms; distinguish draft preview from generated PDF; persist generation freshness and revision snapshots. Fix pagination and currency labeling as required for the supported scope. Check Chromium availability separately on the deployment host.

### 4. WhatsApp completion

Implement composer attachment/caption staging, retaining quotation ID and revision through successful sending. Link the actual outgoing message to that snapshot and update sent state reliably, without duplicate delivery on retries. Expose document/send history in the quotation workspace.

### Later scope

Reusable term/item templates, bulk item entry, structured payment milestones, customer acceptance, follow-up reminders and a deliberate won-to-job handoff can follow the core workflow. Automated pricing, tax, stock management and AI quotation drafting need separate specifications. Any future AI drafting should use confirmed catalog/customer evidence and the installed TypeSafe skill/live docs; prices and final sending remain human-controlled.

## Acceptance checks

- Saving and reopening preserves all customer fields, terms, section order, dimensions, accessories and discounts.
- A failed whole-document save leaves the previous persisted version intact; conflicting edits can be recovered.
- Preview, saved server totals and generated PDF agree for every supported discount/tree case.
- Unsaved edits cannot produce an older customer-facing PDF by accident; previously sent PDFs stay retrievable.
- WhatsApp preparation stages the correct document; only a successful send records Sent, and retries do not duplicate delivery.
- Standalone, contact/deal-prefilled and inbox entry paths converge on the same editor.
- Loading, save failure, export failure, empty catalog and expired quotes have useful visible states.
- Keyboard, mobile, Arabic/RTL, light/dark and long multipage quotation checks pass.
- Existing quotation tests plus focused persistence/render/send tests, typecheck, lint and build pass. Production schema, storage, Chromium and deployed revision are verified separately.

## Evidence consulted

Repository quotation specification (2026-08-14), current detail/list/form/item/action components, shared types/totals/HTML builder and PATCH/send routes. Project hub and linked architecture, code atlas, working guide and Jev proposal were consulted for ownership and workflow context. No production functionality or deployment state is inferred from these sources.
