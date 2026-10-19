# Knowledge, products and conversation recovery

Implemented locally on 18 October 2026 following [the conversation audit](ai-behavior-audit-2026-10-18.md). Application changes remain local. During preview troubleshooting on 18 October, migration 077 was applied to the connected shared database; application deployment and research import remain separate.

## Working with the editor

Open **Settings → Knowledge & products**, or **AI agents → Setup → Knowledge**. Both use the same workspace.

- **Products:** searchable family → product → variant hierarchy. Edit the overview, pricing, facts/sources and AI access independently. Upload photos/documents on their exact product. Arabic/English informal names belong in aliases.
- **Company & policies:** focused company, product, service or policy documents; optional exact-product link; source and review notes. The content contains facts the assistant may use; unresolved disputes belong in internal source notes.
- **HTH research:** the reviewed source map, with an explicit import action creating 10 families, 24 products and 5 variants as drafts. The import is atomic and repeatable for matching names. It never overwrites existing entries or prices. Company contact/service facts have a separate reviewable draft in the company section.

A family groups products. A product may have variants (for example garage doors → Australian rolling / American sectional). A variant has its own price, facts and files. No parent/sibling price, warranty, motor, rating, delivery time or attachment is inherited. There is no copying of the QAR 350–380 **window** price onto garage/shop doors.

Draft entries and branches beneath draft parents are hidden from generation and verification. Existing rows retain approved status for compatibility. Saving a new entry defaults to draft. Approving a product is a staff review decision; publishing a child while its parent is draft does not expose it to the assistant. Move linked children/knowledge before deleting a parent; deletion never cascades through the product tree.

Prices require both finite nonnegative limits and a unit. Family prices are not allowed by the editor/API. Record minimum charged area, motor/installation exclusions and add-ons explicitly. Migration 077 narrowly corrects the existing HTH window entry from linear to square metres only if its ID, account, current 350–380 range and square-metre notes still match; it does not add new prices.

## Sources consulted and conflicts preserved

Vault root: `/Users/naderismail/Documents/Personal Knowledge/`.

- `wiki/clients/hth/Products.md` and `raw/clients/hth/2026-10-09-import/Company profile.md` §04: the ten families and their distinct systems.
- `wiki/clients/hth/Company facts.md`: contacts/workshop, attribution of manufacturer certificates, warranty and founding-date conflicts.
- `wiki/clients/hth/Window shutter motorized system.md` and `Roll-up shutter motorized system.md`: separate systems, installation/operation choices, and unverified technical claims.
- Project hub and linked architecture, atlas, working guide and Jev proposal: current ownership and integration boundaries.
- [Company website](https://hightechub.com/), [window shutters](https://hightechub.com/window-shutters/), [pivot doors](https://hightechub.com/pivot-doors/) and [custom steel doors](https://hightechub.com/steel-doors/), inspected 18 October 2026.

Website marketing is not a certificate for an exact system. The research avoids publishing numeric fire ratings, motor brands/lifespans, general performance guarantees, disputed founding dates, universal warranties or unverified operating hours. Contact/service facts are provided for review. Current account hours remain the operational source. Manual-operation pricing still needs reconciliation between the saved business prompt and the window product notes; no new manual price was invented.

## How the assistant uses the information

The approved catalog, relationships, aliases, specifications, limitations and source links are supplied to the generator and Jev. Internal product source notes are omitted from the generator's factual text. Draft suggestions now receive the catalog too, matching auto-reply/playground evidence.

Retrieval includes the recent four customer turns to resolve short price/location follow-ups without indexing prior assistant guesses. Keyword search matches context terms with OR rather than requiring every word of the transcript. Semantic and keyword RPCs both filter approved documents and linked product ancestry, preserve account/RLS access, and attach document/chunk IDs to excerpts. Two small approved company-wide documents are also included for company facts that short queries such as “where?” may not match lexically. Source notes are not retrieved as business facts.

## Recovery and routing

Policy version: `sales-v6-catalog-recovery`. The support cutoff remains 0.85; explicit-human/handoff thresholds have not been globally lowered.

- A repeated price question is a signal to improve the answer; it no longer forces transfer via a counter.
- Verification distinguishes affirmative claims from necessary questions and conditional next steps. It accepts an approved per-unit estimate without demanding exact dimensions or a site visit, and tests independent known-answer requests separately from primary response relevance.
- Missing/filtered product tags for a quoted price enter the correction step before the sender's final pricing backstop.
- A generated transfer is checked against the actual human requirement. Premature model transfers get one repair; justified transfers remain respected.
- After two rejected candidates, the audited ambiguous shutter case may use one narrow clarification template. It makes no product supply or pricing assertion, writes no fields/tags/media, and passes the same verifier before use. Already supplied/asked product distinctions suppress it. Verification outages do not trigger a third service call.
- Real input human/complaint routing stays intact. Inspection handoffs use a scheduling-specific closing without claiming a confirmed appointment. Job/supplier guidance avoids sales qualification and invented HR contacts or vacancies.
- Staff notes and `conversations.ai_handoff_reason` retain a structured final reason, failed enforced checks and attempt number. Judgment logs record enforced failures, advisory mode, product/source IDs and policy version without raw customer/candidate text. Reply events distinguish final routing reasons.

No rejected text is sent. Optional field/media rejection remains separate from supported reply text. Existing freshness, assignment, consent and atomic reply-slot checks remain in place.

## Verification

- Full normal suite: 1,384 tests passed. Four additional API regression cases passed afterward; all 78 tests in the final affected routing/catalog/API subset also passed.
- Live Jev: all 35 opt-in synthetic tests passed, including English/Arabic shutter clarification, an approved estimate without dimensions, a garage price incorrectly borrowed from a window product, unsupported bookings and an unjustified generated transfer. Early runs exposed false rejections; the question definitions were corrected without lowering thresholds.
- Production build succeeded. Existing Next.js middleware deprecation/edge-runtime notices remain.
- Isolated PostgreSQL with pgvector executed migration 077 and checked hierarchy/cycles, account boundaries, RLS, draft ancestors/documents in both retrieval paths, source IDs, keyword context, deletion protection, atomic/idempotent draft import and admin restriction.
- Browser fixtures: product edit/save, draft variant creation with parent preserved, company-document editing, viewer read-only state, 390/1280/1440px layouts, Arabic/English, light/dark; no page errors or horizontal overflow. These are component fixtures with mocked APIs/auth, not a live production session.

Browser artifacts: `/tmp/wacrm-catalog-preview/`. Isolated SQL validation: `/tmp/wacrm-catalog-validation/check.mjs` (temporary test-only PGlite/pgvector installation, no project dependency added).

## Deployment order

1. Review the existing dirty working tree independently; it contains unrelated pre-existing security/quotation/conversion work. Do not assume every modified file belongs to this task.
2. Apply `supabase/migrations/077_ai_catalog_knowledge.sql` through the existing migration process. Existing entries remain approved; this stage creates no research rows.
3. Deploy the application changes and verify `sales-v6-catalog-recovery`, approved-only catalog loading and successful retrieval. The application requires the new columns; deploy the migration first.
4. Only after the new runtime is active, import research drafts through the workspace. Older runtimes do not filter draft catalog rows, so do not import drafts before deploying the new loader.
5. Review, consolidate existing broad entries and approve the selected new branches. Existing prices and media stay on their current product IDs until deliberately moved. Approve focused company facts; retain unresolved technical/pricing claims in review notes.
6. Monitor actual final handoff reasons, first-turn avoidable transfers, repeated unanswered price questions and recovery outcomes. Synthetic success does not establish a measured live handoff reduction.

Rollback: retain the additive schema, withdraw newly published branches/documents, and roll back the application only with research drafts removed/isolated; an older loader would otherwise read them. Never re-enable paused customer threads in bulk as part of a deployment.

## Connected database repair during preview

The authenticated local page initially returned HTTP 500 because `ai_products.parent_id` did not exist. Migration 077 is now applied to the linked database, recorded as `20261018190000` / `077_ai_catalog_knowledge`. Only this migration was executed; unrelated pending migrations were not applied. The same PostgREST product query used by the app now succeeds and returns the three existing products, all approved. Names, descriptions, tag links, notes and numeric price amounts were verified against a private pre-migration snapshot. The narrow square-metre unit correction applied to the existing window-shutter row. The knowledge query also succeeds for the existing document. No research drafts were imported and no application/AI runtime was deployed.

## Company-supplied catalog organization

Following the user's instruction, the connected account's three original company entries were organized in one transaction into two approved families (window shutters; garage/shop doors), with the three original product IDs retained and seven approved door variants. Garage Australian/American facts are separate from the five shop-door variants. Only company-supplied facts were carried forward; uncertain heights, warranty coverage, size limits and manual-operation charges remain explicitly unresolved.

All 23 existing media associations, original tag links, numeric price amounts and price units were verified unchanged. Raw descriptions and original pricing notes are archived in each original product's internal source notes. The window pricing notes now distinguish the stored range, separate motor cost, and unresolved handle charge instead of presenting that ambiguous charge as approved pricing. New variants have no invented price and share their original parent product's CRM interest tag intentionally.

A draft knowledge document named **أسئلة الشركة المفتوحة — أبواب الكراجات والمحلات وشتر النوافذ** contains 23 unanswered checklist items, grouped by shared pricing/terms, garages, shops and window shutters. It has no indexed chunks and is excluded from approved knowledge retrieval. Product-specific questions also remain in source notes. Company answers should be reviewed and applied only to the relevant product/variant; the question list itself must not become approved factual knowledge.

The account-specific operation is recorded in `scripts/organize-hth-company-catalog.mjs` (dry run by default; explicit `--apply`; repeated runs detect completion and make no changes). A private pre-change snapshot and plan were saved outside the repository. This was catalog data organization, not an application deployment or a customer/company message send.

## Commit readiness — 19 October 2026

The deployment-equivalent webpack build, TypeScript check, full normal test suite
(1,388 passing tests), and isolated migration/security fixture checks passed.
Lint has zero errors and pre-existing warnings. The public audit summary excludes
customer identifiers and transcript excerpts; detailed evidence remains private.
The new Docker/update preflight requires migrations 076 and 077 before promotion.
Only 077 is currently applied to the connected database; application deployment
and 076 remain separate from committing/pushing the feature branch.
