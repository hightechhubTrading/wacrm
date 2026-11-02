# Quotation redesign

The shared company catalogue now drives quotation selection, configuration, pricing evidence and item references. Names and wording are normalized from documented company records; missing commercial decisions remain explicit.

## Requirements and implementation

| Requirement                          | Implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One product inventory                | `catalogue-server.ts` reads canonical prepared products and source links. `sellableCatalogue` exposes leaf configurations while retaining the three-level family/product/variant tree. 334 canonical and projected identities retained; 45 targeted SKU, unit and specification updates applied.                                                                                                                             |
| Product references and configuration | `product-profile.ts` derives WS/SEC/MOT/service references and documented units. Drawing/opening references remain separate from internal SKU and line reference. Configuration controls depend on the selected product.                                                                                                                                                                                                     |
| Pricing                              | Only exact recorded rates are selectable; source snapshots retain provenance. No range minimum or currency conversion is inferred. Missing unit/rate/dimensions blocks issue. Included, additional and optional equipment are explicit choices.                                                                                                                                                                              |
| Structured payments                  | `payment-plan.ts` normalizes equivalent source wording and separates percentages from events. Unknown ranges/events remain incomplete. Issue requires 100% and specified events. Currency rounding preserves the exact quotation total.                                                                                                                                                                                      |
| Editor                               | One product list, one item editor and persistent summary. One catalogue picker groups products/equipment/services and configurations. Source/cost tools are scoped to the selected product. Commercial terms appear once; preview uses a dedicated modal.                                                                                                                                                                    |
| PDF                                  | Chocolate brown commercial hierarchy, compact bilingual rows, inline facts and full-width selected specifications. Sales name comes from the creating user's profile. The navy sales-only seal overlays the bottom stamp area; name/date sit on their lines. Date uses Qatar's current business date at generation. Customer approval fields are omitted because acceptance is digital. Issued PDFs remain stored snapshots. |
| End-to-end examples                  | Shutter, sectional garage door and mixed offer journeys cover English/Arabic, light/dark and 390/1440 widths. Separate checks cover both standalone and deal-based creation.                                                                                                                                                                                                                                                 |

## Verification

- `npm test`: 1,634 passing, 68 skipped, 200 files.
- `npm run typecheck` and production build.
- `PLAYWRIGHT_CHANNEL=chrome node scripts/check-quotation-redesign-browser.mjs --catalogue <private-live-catalogue.json>`: 24 full workspace journeys; writes intercepted.
- `PLAYWRIGHT_CHANNEL=chrome node scripts/check-quotation-creation-browser.mjs --catalogue <private-live-catalogue.json>`: 16 creation entry-point journeys; writes intercepted.
- `scripts/check-quotation-creation-db.mjs`: disposable PGlite checks migrations 092/093, seed ownership, leaf restrictions and structured metadata validation.
- Live deployment RPC preflight and owner-scoped transaction smoke verify the source-backed shutter at QAR 390/m², 138 × 165 cm, QAR 888.03; synthetic writes roll back.
- Before/after comparison preserves 9 quotations, 11 line items, 3 issued documents, 46 questions, 6,756 source reviews and all recorded prices. Contacts may change through ordinary live activity; the rollout does not write contacts.
- All 23 supplied source files retain their original hashes.
- Actual rendered A4 examples have two pages each. The offline interactive preview and sample PDFs are in the sibling `SYS/deliverables/quotation-redesign` directory; private source/customer data is excluded from git and container build context.

Migration 093 is additive and already applied with ledger version `20261102210635`. The first attempted catalogue transaction was rejected by the existing hierarchy constraint and fully rolled back; the final update preserves that hierarchy and enforces leaf-only quotation selection instead.

Application deployment verification is recorded after promotion; private logs are under `.local/quotation-redesign` and are excluded from the repository.

## Live rollout

Application revision `11d5286dfde948b5d72e1a9485156ef4885f5c85` is deployed at https://wacrm.srv1795091.hstgr.cloud. The resource-capped updater completed its candidate checks, database preflight and promotion. Exact live revision verification passed. Login returns 200, the protected quotations page redirects to login, and signed-out quotation/catalogue APIs return 401. No candidate containers or candidate environment files remain; the private source pack is absent from the image.

The post-deployment comparison confirms all 9 quotations, 11 line items, 3 issued documents, 46 questions and 6,756 source-record review states remain unchanged. Temporary SSH access was removed, subsequent authentication was denied and local temporary keys were deleted. The previous application image remains available as `wacrm:rollback`.

## Reusable commercial terms

Commercial delivery/warranty choices now come from the selected product families, including documented custom-colour periods. Equivalent wording is deduplicated for display without changing the stored quote until staff select or edit a value. Scope and additional notes also use dropdowns; Edit and Custom expose text entry. Payment arrangements fill the structured schedule, common percentages are dropdowns, and custom exact percentages and event labels remain available. Unknown recorded events still require a choice before issue.

Verification: 1,636 tests pass (68 skipped), TypeScript and production build pass, changed-file lint is clean, and 21st review reports no findings. The 24 editor journeys additionally verify prefilled delivery/warranty dropdowns and custom delivery edits surviving the dropdown transition and save.

Commercial-term presets deployed at application revision `ebb130636c6382f008ebdd19c46280fc04f4ce89`. Exact live revision and public authentication checks pass; no candidate containers/environment files remain. Temporary SSH access was removed and authentication denial verified. Custom 17.5% entry was additionally checked through a full save/document journey.

## Payment allocation limit

Each instalment is capped at `100 − the other instalments`. Dropdown choices above that limit are disabled, custom input is clamped to it, and adding a payment is disabled at 100%. Reducing an existing share frees capacity without changing the other payments. Shared draft validation also rejects totals above 100%; issue still requires exactly 100% with defined milestones.

Verification: 1,637 tests pass; TypeScript, production build and changed-file lint pass. Three complete shutter/garage/mixed browser journeys verify disabled excessive choices, custom `999%` capped to the remaining allocation, and the add-payment limit, followed by normal save/document generation.
