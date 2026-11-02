# Quotation findings integration — 2 November 2026

Implementation of the four-stage quotation improvement plan. The supplied archive is evidence awaiting HTH review. No source document instructions are executed. This implementation does not approve prices, supplier units, component equivalence, engineering rules or customer outcomes on HTH's behalf.

## Available workflows

- **Quotations → Price sources and customer history** opens `/quotations/knowledge`. Agents can search source records; account administrators/owners can import and review them. Reviews require confirmation notes and use optimistic version checks. Original source rows and review history are immutable to authenticated users.
- **Products/services → Reviewed products, pricing and material calculations** in a quotation selects an approved product preset, selling-price rule or technical index reference. All 16 extracted product families can be reviewed; the first practical pilots are window shutters, roll-up doors and pivot doors. A product preset clears the previous product's price and can apply a separately confirmed exact rate. The archive pivot range is never turned into a default rate.
- Rules support area, minimum area per opening, width bands, per-piece prices, width-priced accessories and explicit supplier-grid boundaries. Grid prices must first be confirmed in QAR; the dated EUR source and suspect cells remain visible. Grid interpolation, exchange rates, colour extras and motor-package assumptions are not inferred.
- Fifth-sheet/manual adjustments require explicit approved QAR amounts per opening. Column O/P/R/S attribution must match the original source value; an amended rate must be recorded as directly confirmed.
- Prices capture source batch, source row, approval version, approval timestamp, dimensions, quantity and calculation configuration in `document_details.knowledge`. Changing dimensions, units, quantity or the applied price requires reapplication or a reasoned manual override before PDF generation. Manual overrides retain the previous evidence.
- An approved product may carry model-specific delivery/payment/warranty text and validity. **Apply approved terms** copies that text explicitly. The commercial selector also offers editable archive suggestions (villa 100% advance; fabricated 70/30; contractor 60/30/10; 10-day validity), labelled as suggestions rather than company-wide rules.
- **55 mm shutter cut-list pilot** calculates slats, guides, box and tube cuts, and operation-dependent parts. Assumed and missing quantities are distinguished. Both cut-list and internal-cost CSV exports are clearly draft/internal documents and record the dimensions and rule version. The Y/N split, springs, fixings, tube wall thickness, motor torque and compatibility still need production confirmation. No production-release action is provided.
- Internal cost estimates use individually approved supplier offers with an internal item mapping, currency, price unit, exchange rate, effective date, freight, duty and clearing. Metres per purchased bar must be explicit. Missing/assumed quantities must be entered deliberately. Labour, installation, delivery and other cost inputs must all be filled, including zero costs, before an estimated margin is shown. The margin is for the selected parent line, after its item discount and before order discounts, associated separately charged accessories and overheads. Net cut lengths do not establish bar-purchasing quantities or waste allowances; those need review. **Keep estimate in quotation draft**, then save the quotation, persists the estimate and its source snapshots.
- Customer history uses exact normalized spelling aliases from `clients_master.csv`, retaining source rows and issue flags. Historical quotation/invoice/job records are stored separately from live quotations and contacts. No historical pipeline-value or invoice-payment total is produced. Unmatched quotes retain unknown outcomes; an invoice is not payment confirmation. Possible source-client merges still require human review.
- **Quotation follow-up and outcome reason** stores a note and follow-up date independently of issued quotation content. The source library's **Follow-ups** tab lists scheduled notes with links to the existing quotation/status controls. Saving these notes does not invalidate the PDF or change commercial workspace versions.
- Technical references use the supplied submittal **index**. Selecting an index reference does not upload or attach the underlying PDF, or assert that a supplier certificate approves a particular project/model. Original technical files must be available in the existing media workflow for actual customer attachments.

## Source preparation and import

From the repository root:

```sh
python3 scripts/prepare-hth-quotation-knowledge.py --source ../.. --output .local/hth-quotation-knowledge.json
```

The prepared private pack contains **23 sources / 6,756 records**, including 132 cleaned price lines, 16 product rows, 127 client aliases, 561 quotation rows, 201 extracted invoice rows, 127 billed-job records, 249 merged component candidates and 4,053 supplier grid cells. The earlier 139-row price extraction and 271-row component draft remain labelled superseded. Source inventories, merge mappings, supplier codes, delivery evidence, material rules, examples and all five supplied Markdown documents are included. SHA-256 hashes record the exact input versions; the pack identity also includes the extractor version. Three malformed source rows contain unquoted commas (pergola name, pivot price range and one source-coverage note). Extractor v2 reconstructs those identified fields, retains the original parsed cells and adds a visible parsing-review note. Unknown column-count errors stop pack preparation. All resulting records must also pass the application validator before import. Counts describe the extracted files, not complete company transaction coverage.

The pack lives under gitignored `.local/`; neither customer names nor source documents are bundled in client JavaScript or committed as application data. The checked-in BOM test fixture contains only dimensions and extracted calculation results, without client identities.

Apply reviewed migration **090_quotation_knowledge.sql** before promoting the application. The existing deployment preflight now checks its four new tables. Follow the repository's timestamped linked-migration process; do not push the entire numeric migration directory.

An account administrator imports the JSON file from the source library **into the currently authenticated account**. The caller cannot choose a different account in the request. Importing the same source version is idempotent and retains existing reviews; a changed source pack creates a separate batch with all records pending. Import does not write to live catalogue products, contacts, quotations, invoices, stock or AI knowledge. Optional catalogue-product mappings are checked against the same account.

## Approval and document invariants

`quotation_knowledge_batches` and `quotation_knowledge_records` preserve original evidence; `quotation_knowledge_reviews` records every review version. Agents can read their account's sources/review evidence; only administrators can review/import via guarded RPCs. Account and assigned-quotation boundaries govern sales notes. Anonymous access and direct authenticated source/review writes are denied.

Workspace saves check new evidence against the current approved source. Existing snapshots and both PDF-generation routes verify original approval versions against the append-only review history. This also catches fabricated approval metadata written through a direct workspace RPC, while allowing a saved quotation to retain its genuinely approved historical price. Lookups are batched and capped at 1,000 evidence references per document. Supplier costs, source records, override history and internal estimates do not render in the customer quotation HTML; issued PDF snapshots retain their audit metadata internally.

The existing quotation reference sequence, account/reference uniqueness, revision workflow, numeric totals and generated amounts in words remain the basis for newly issued quotes. Source reference discrepancies and duplicate historical numbers remain flagged as evidence rather than silently rewritten.

## Verification

```sh
python3 scripts/test_prepare_hth_quotation_knowledge.py
npm run typecheck
npm run lint
npm test
npm run build
node --test deploy/check-database.test.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js \
  QUOTATION_KNOWLEDGE_PACK=.local/hth-quotation-knowledge.json \
  node scripts/check-quotation-knowledge-db.mjs
PLAYWRIGHT_CHANNEL=chrome node scripts/check-quotation-knowledge-browser.mjs
21st review src/components/quotations/knowledge src/components/quotations/quotation-workspace.tsx
```

The disposable SQL checks cover import idempotency, pending defaults, raw-data immutability, review conflicts/audit, account and catalogue ownership, admin/agent/anonymous boundaries, bilingual alias matching and sales-note independence from issued PDFs. The optional pack argument imports all supplied records into that disposable database only.

Calculation tests compare all **221 extracted worked examples**, including duplicate orders. This is regression coverage of the supplied extraction; it does not independently establish the source report's claim of 173 cached Excel matches or provide engineering sign-off.

Synthetic browser checks render the real components in English/Arabic, light/dark and at 390/1440 px; they exercise source pricing, stale-price warnings, reasoned overrides, BOM export, keeping cost estimates in drafts, incomplete-margin gating, source reviews, customer history and follow-up notes. Screenshots stay in `.local/quotation-evidence/`. Browser fixtures do not send messages, approve company data or call a live account.

## Remaining HTH decisions and rollout state

Business confirmation remains required for price-column meanings; per-metre versus per-bar supplier units; ALUSOL/Kuwait currencies; uncertain component merges; model-specific warranty/terms; missing BOM/production rules; current GTR prices/erroneous cells; and historical outcome/client matches. Stock counts remain deferred, as requested in the source decision.

Migration 090 is applied to the linked production database as `20261102103055`. The HTH account source pack is imported: 23 sources, 6,756 pending records, zero approvals and zero review records. Import checks preserved the existing counts of 9 quotations, 3 quotation documents, 1 quotation catalogue item, 52 AI products and 653 contacts. The corrected pack identity is `f41bf6bc905433e877ba0588918ac699b5f8642aa137f360d4b4b7550847ff26`. Application promotion and company approvals remain pending. Private migration/import evidence is retained under `.local/quotation-rollout/`; the original supplied sources remain unchanged.
