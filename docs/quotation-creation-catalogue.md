# Quotations from the shared catalogue

New quotation, quotation creation from a deal, Add product, Browse catalogue and accessory selection now use the same canonical `ai_products` inventory maintained in Knowledge. Search covers normalized English, Arabic, aliases and company codes. Products, equipment, materials and services have separate filters; browsing is no longer limited to the first 20 matches. Existing project Dialog/Button/Input components and design tokens are reused.

Selection fills the documented name, Arabic name, specifications and quantity unit. New drafts can also take the recorded delivery, payment and warranty terms. Multiple payment plans require an explicit selection; an unspecified milestone remains unspecified. Legacy example specification presets are hidden for catalogue-linked items. Included equipment remains included rather than becoming a second charge.

Fixed QAR prices can fill automatically. A range never silently supplies its minimum. Staff may explicitly select a linked price-list row and O/P/R/S column; the quote captures that source and choice. Supplier EUR grids and offers are visible as reference data, without assumed exchange rates or margins. Existing issued quotations retain their snapshots.

The creation API resolves IDs and source choices again under the caller's account and ignores submitted catalogue amounts/descriptions. A new draft persists its initial item as `document_details.catalogueSeed`; the first normal workspace save consumes it into `quotation_items`. Migration 092 extends the existing document-detail validator to accept the seed and source knowledge, checks seed ownership/readiness, and rejects seeds on issued/versioned quotes. Deployment preflight checks this schema before promotion. Normal save/PDF validation still verifies source snapshots.

Fifteen previously unprojected company service rows now have canonical entries: removal, delivery, painting and two civil-work services. Thirteen single-price rows retain their recorded fixed amounts. The two civil-work rows retain separate selectable column rates. Original source data and existing quotation numbering remain intact.

Validation: 1,620 tests passed, 68 skipped; 33 deployment-preflight tests; disposable database checks for metadata, account ownership and seed consumption; TypeScript; targeted lint and 21st review; eight English/Arabic, light/dark, mobile/desktop creation journeys with intercepted writes. A live owner-scoped transaction verified source proof, draft creation, dimensions and the QAR 888.03 area total, then rolled back. Private fixtures, screenshots and database evidence remain in `.local/quotation-creation/`.

## Live rollout — 2 November 2026

Application revision `fb9b7cd33a3e4beb049b6b7dcd20ee6674ebe2d6` is deployed. Migration 092 is recorded as `20261102182000`. The shared inventory and quotation projection each contain 334 identities, including 324 documented records and 15 selectable services. The previous 318 product records and all 9 quotations, 11 item rows, 3 issued documents, 46 questions and 6,756 source reviews were preserved. The account had 656 contacts before and after this change. All 23 original source-file hashes still match.

The server build, database preflight, login/PDF checks, active-call gate and exact-revision verification passed. Signed-out catalogue/quotation APIs return 401; the quotations page redirects to login. No candidate containers or environment files remain, and the private pack is absent from the image. Temporary deployment access was removed, a subsequent SSH attempt was denied, and local temporary keys were deleted. `wacrm:rollback` retains the prior application image.
