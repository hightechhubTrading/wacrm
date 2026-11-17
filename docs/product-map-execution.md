# Product map execution

The user authorized execution of `docs/product-map.md` on 17 November 2026. The complete target remains eleven product categories and 33 products, separate add-ons/services/workshop parts, four standard questions plus product choices, compatible add-ons, product-only chat photos and recoverable historical records. The 41/55 company answer applies only to those two products. Motor rules, package contents and genuinely missing product details remain open.

Preparation has captured the linked account's current 334 product identities, questions and 56 media rows under `.local/product-map/`. These counts supersede earlier inventory snapshots; the migration must use the current snapshot. The initial inventory transaction is now committed; see the verification below.

`scripts/prepare-product-map.mjs` creates a private manifest from that snapshot and the actual product-map tree. It checks eleven categories, 33 products, unique target identities and unambiguous source-name matches. It reuses 26 existing identities and proposes 18 new identities (categories and products combined). Forty-one other product-type records are listed for retention and hiding; components, equipment and services require their own classification pass. Product-specific plan sections are retained in the manifest so technical choices are not lost during migration.

Private artifacts: `before.json`, `before-response.json`, `schema.json`, `manifest.json`, `preservation.sql`, and `preservation-before.json`. They contain account data and must remain outside Git. New IDs are deterministic within the account. The manifest is preparation, not an applied migration or verification report.

Remaining execution:

1. Complete bilingual fields, product codes, standard/product questions and compatible add-ons. Preserve established details and prices; do not copy a broad family rate into a newly split product.
2. Complete legacy replacement mappings. Split ambiguous records without declaring a false one-to-one replacement. Move children before converting variants to products because the live schema checks hierarchy.
3. Classify equipment, services and parts onto the other shelves; retain excluded ranges and superseded records privately.
4. Inspect and assign the 56 media rows by actual depicted product. Preserve ambiguous attachments until identifiable; ensure they cannot enter product chat selection through old groups.
5. Generate a guarded account-scoped transaction with freshness checks and preservation assertions. Rehearse with rollback, apply and independently compare historical quotation/source fingerprints, prices, links and attachments.
6. Verify the resulting inventory, quotation selection and product-only chat photo flows. Verify any application changes and deploy through the project's existing release gates if required.

Do not mark the goal complete until these steps have authoritative evidence.

## Applied inventory and remaining application work — 17 November 2026

The guarded transaction passed two rolled-back rehearsals and then committed. Independent linked-database verification found all eleven target categories and 33 target products, 352 canonical identities and 352 quotation projections, all 334 original identities retained with identical price values/SKUs/tag IDs, and all 46 original question rows identical. Two answered specification questions record the supplied 41/55 information. Thirty-two installation photos were reassigned and 24 attachments retained without changing file identity, content metadata or storage paths. Historical quotations, items, issued documents, immutable source records/reviews, product-source links and knowledge documents match their pre-migration fingerprints exactly. Evidence: `.local/product-map/verification.json` and `after.json`.

Sliding Door, Folding Door and uPVC Door remain internal drafts because the map explicitly leaves supply confirmation open; the existing uPVC Window identity remains documented. This is 33 target records, not 33 confirmed customer offerings. Old product groups and excluded ranges are retained as hidden drafts. Equipment, components and services remain separate inventory types and are hidden from customer knowledge.

Local application changes now give the manual chat library category → product → files navigation and reject draft/hidden/superseded/internal branches. AI prompt media excludes non-product shelves and family-level files. Twenty focused tests, TypeScript and scoped lint passed; 21st review reported zero findings (catalog inspiration search returned HTTP 401, so existing project primitives were reused). These code changes have not been deployed or browser-verified.

Remaining work is still required before goal completion: complete structured quotation choices and add-on compatibility; keep workshop parts out of sales quotation selection; add the missing service records; complete product record package/exclusions and Arabic descriptions; inspect/reassign any remaining identifiable installation media (the initially slow downloads have now all finished; image index 33 is another Swing gate); verify bilingual/mobile/browser flows; build and deploy the scoped app changes through existing release gates; reverify live data and behavior. Standard package, delivery/warranty, motor sizing and 77-specific facts remain open where not established by evidence.

Do not rerun the initial apply script against the changed live state: its freshness guards intentionally reject it. Use the current `after.json` as the baseline for guarded follow-up transactions.

## Service shelf and quotation questions — 17 November 2026

The second guarded transaction passed a rolled-back rehearsal and committed six service records: Site Visit and Measurement, Electrical Connection and Box and Decor Work are documented internal services; Repair Visit, Motor Replacement and Annual Maintenance remain internal drafts pending the availability decision already identified in the map. Installation is included in product specifications and was not introduced as a separately chargeable service. No service price was invented.

The final slow image downloads were inspected. Another Swing installation image was assigned to Swing, and a window installation originally filed under Garage Doors was moved to the retained, hidden window-shutter record because its slat size is unidentified. There are now 33 exact product photo assignments, one corrected internal category attachment and 22 other retained attachments. All 56 file identities and storage paths remain intact. Independent follow-up verification found 358 canonical/projection identities, all prior 352 product rows identical, all 48 question rows identical, and unchanged historical fingerprints. Evidence: `.local/product-map/followup-verification.json` and `followup-after.json`.

Local quotation profiles now parse only the explicit product-map configuration line into product-specific questions, with standard operation/finish/use questions. Width and height retain their existing measurement controls. 41/55 colours are restricted to the supplied beige/white; 77 has no inferred colour list. Sectional operation is motorized-only. Question labels are bilingual in the editor and PDF. Workshop components are filtered from the sales catalogue. Equipment matching no longer silently falls back to all equipment when no compatible source family is documented; standalone equipment search remains available.

Verification so far: all 175 quotation tests passed, full suite 1,887 passed (74 skipped), scoped lint and TypeScript passed, production build passed, and 16 synthetic bilingual light/dark/mobile/desktop shared-inventory browser renders passed. The quotation browser harness requires a catalogue fixture and initially exited for a missing argument; it is being rerun against the historical private catalogue fixture (its cases assume the former names and exact recorded rates). This is a regression check, not proof of the new live product-map choices. New-map browser checks, Arabic option translations, final record-field review, source-compatible add-on coverage, scoped deployment and live verification remain outstanding.

## Live catalogue and new-map browser verification

The real `loadQuotationCatalogue` path was exercised read-only against the migrated account. It returns 30 offered product leaves and no workshop components. All 30 products have unique configuration question keys and a Used for question; the exact 41/55 colour lists and unspecified 77 colours were checked. This check exposed duplicate frame/door keys on Glass Partition; they were fixed into independent questions and a regression test was added. Snapshot: `.local/product-map/catalogue-live.json` (private), generated by `scripts/snapshot-product-map-catalogue.mjs`.

Arabic display labels now cover the product-map option values while saved choice values remain stable. The new-map quotation browser run passed eight complete shutter journeys across English/Arabic, light/dark and mobile/desktop. It selected the migrated Window Shutter 55, checked the supplied colour choices, selected operation and box shape, entered use and dimensions, added included equipment, saved the synthetic quotation and rendered its customer document. The amount was explicitly entered as a synthetic quotation price where no direct recorded rate exists; no company default price was inferred. No live writes occurred. Three historical-fixture shutter/garage/mixed journeys also passed.

The new manual chat-picker harness uses the actual migrated inventory fixture and real component. Its first run failed because the test assumed the wrong Back button translation; the harness was corrected to use existing Back/رجوع labels and is being rerun. This is a test-selector correction, not a product change. Pending: finish this browser run, final record/bilingual/add-on review, exact scoped release checks, deploy, and verify live. Do not claim application deployment has happened.

The corrected manual chat-picker run passed all eight migrated-inventory journeys (English/Arabic, light/dark, 390/1440 px). It verified category navigation, exactly three window-shutter products, no guessed photos on the 55 product, navigation back to categories, and staging an identified Swing installation photo. No WhatsApp send occurred. Evidence: `.local/product-map/picker-browser.log` and screenshots under `picker-browser/`.

## Final record review and release preparation

All 33 product records now have cleaned Arabic descriptions, including the exact supplied 41/55 specification text. A guarded rehearsal and commit changed only Arabic descriptions and update timestamps; SKU, price, source and identity fields were checked unchanged. Gate add-on selection now uses the documented SW family for Swing and SL for Sliding while retaining the existing SD quotation-reference codes.

The latest three-component 21st review reports zero findings. Hosting connector list/details requests did not return and were cancelled as read-only requests; no hosting changes were made through them. Existing deployment access is being checked before the scoped release. Final verification evidence is in `.local/product-map/final-verification.json` when the independent read completes. Application deployment remains pending.

## Scoped release ready; deployment access required

Source revision `0c5919c7b0ceacb65e12f7ac135e2dc67a4a8568` is committed and pushed to `feat/ctwa-conversions`. An isolated worktree of that exact revision passed all 1,887 tests (74 skipped), production build and 48 deployment-preflight tests. Uncommitted mobile/push work is excluded. The final independent data check verified 358 canonical/projection identities, 56 media rows, 48 question rows and unchanged historical fingerprints after the 33 Arabic descriptions were applied. All original prices/SKUs/tags are preserved.

Deployment is not complete. The Hostinger VPS connector's read-only list/details requests did not return; a final bounded read timed out after 90 seconds. Default SSH and the existing HTH tools key were denied (`Permission denied (publickey,password)`). No temporary SSH key was installed, no server application change was made, and no deployment credential cleanup is outstanding. The user has been asked to reconnect the Hostinger VPS connector or restore SSH deployment access. This is an access dependency, not an approval request. The deployment and live-behavior verification remain required for completion.

## Completion-audit correction: separate inventory shelves

A review of the default settings screen found that it still opened on All inventory, mixing products, equipment, services and components. The screen now opens on Finished products and offers exactly four separate shelves: Finished products, Add-ons, Services and Workshop parts. Switching shelves clears the previous shelf's editor, preserves the review-status filter, and shows counts for the selected shelf. Direct product links select the matching shelf once without forcing later edits back to the original shelf. This completes the plan's four-shelves rule in the inventory management UI as well as quotation/chat selection.

The synthetic browser fixture now includes one record from each shelf and checks that each shelf shows only its own record in English/Arabic, light/dark, mobile/desktop; the first extended run exposed an English-only test locator for Arabic fixture names, which was corrected. Scoped lint, TypeScript and 21st review pass. Deployment access remains unavailable after another SSH check; the access request is still pending. The release will include this audit correction before deployment.

The final shelf test diagnosis was ambiguous naming between the record editor's Inventory category field and the shelf filter. The filter now has a distinct Inventory shelf / قسم المخزون accessible label and ID. The corrected extended suite passes all 16 inventory/findings renders and checks all four shelves independently in each language/theme/viewport. Switching the shelf clears the editor and preserves existing preparation/answer state. No customer or database writes were made by this browser check.
