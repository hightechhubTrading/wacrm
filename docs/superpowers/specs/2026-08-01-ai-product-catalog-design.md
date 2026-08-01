# Group AI media-library files under products

Date: 2026-08-01

## Problem

`ai_media_library` (migration 038, extended by 053) is file-per-row:
every image or document you upload to the AI's catalog carries its own
copy of name, description, and price fields. A product with a photo
*and* a PDF catalog needs two rows, with the name/description/pricing
retyped (and free to drift) across both. This spec splits "product
info" from "files" into two tables so a product's info is entered
once and any number of files can hang off it.

It also fixes a coupling bug this surfaced: today the model flags "this
product is the topic of conversation" (`productTagId`) by picking the
same flat-list id it would use to attach a file (`mediaId`) — there is
no way to represent "the product" independently of "one specific file
belonging to it." Splitting the tables gives tagging its own id space.

## Goals

- Product info (name, description, price range/unit/notes, tag) is
  entered once per product, not once per file.
- A product can have zero, one, or many files; each file gets an
  optional short label ("front view", "full catalog") to disambiguate
  within a product.
- The AI still attaches at most one file per reply (unchanged
  behavior) but reasons about it as "best product → best file within
  it," and flags a product as the conversation topic (for tagging)
  independently of which file it attached, if any.
- The manual inbox catalog picker becomes a two-step product → file
  flow instead of one flat list.
- Existing data (today: one row, one account) migrates automatically,
  no manual re-entry.

## Non-goals

- Multi-file attach in one reply (e.g. sending a photo + PDF
  together). Explicitly deferred — stays one file per reply.
- A public-facing storefront/catalog. This remains an internal,
  AI/agent-facing reference library.
- Reordering/pinning files within a product, or a "primary photo"
  concept. Files within a product are unordered; the model/agent picks
  by label + kind.
- Any change to the `ai-media` storage bucket layout or upload size
  limits (`MEDIA_MAX_BYTES_BY_KIND`).

## Architecture

### Data model

Two new tables replace `ai_media_library`, named with the `ai_`
prefix to match `ai_knowledge_documents` / `ai_config` / the table
being replaced:

```sql
CREATE TABLE ai_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL,     -- what the AI reads to judge relevance
  tag_label text,                -- optional; CRM tag name override (was product_label)
  tag_id uuid REFERENCES tags(id) ON DELETE SET NULL,
  price_min numeric,
  price_max numeric,
  price_unit text,
  price_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_products_price_range_check
    CHECK (price_min IS NULL OR price_max IS NULL OR price_max >= price_min)
);

CREATE TABLE ai_product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ai_products(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label text,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'document')),
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`account_id` is denormalized onto `ai_product_media` (rather than
requiring a join through `ai_products` for every RLS check) — the same
pattern `contacts`/`conversations` already use elsewhere in this
schema, and it keeps the RLS policies below identical in shape to
`ai_media_library`'s today.

RLS on both tables mirrors `ai_media_library`'s existing four
policies exactly: `SELECT` = `is_account_member(account_id)`,
`INSERT`/`UPDATE`/`DELETE` = `is_account_member(account_id, 'admin')`.
`updated_at` trigger on `ai_products` only (files are immutable once
uploaded — editing a file means delete + re-add).

`tag_id`'s FK (checked directly against the live schema:
`ai_media_library_tag_id_fkey` → `tags(id) ON DELETE SET NULL`)
carries forward unchanged onto `ai_products.tag_id` above.

### Migration (057 — next free number; `supabase/migrations/` currently
ends at 056, with two files both prefixed 053 from a recent merge —
verify the actual next-free number at implementation time rather than
trusting this spec if more migrations have landed since)

Idempotent backfill, mirroring the shape of migration
053_price_range_estimate.sql's own backfill block:

```sql
INSERT INTO ai_products (id, account_id, created_by, name, description,
  tag_label, tag_id, price_min, price_max, price_unit, price_notes,
  created_at, updated_at)
SELECT gen_random_uuid(), account_id, created_by, name, description,
  product_label, tag_id, price_min, price_max, price_unit, price_notes,
  created_at, updated_at
FROM ai_media_library;

INSERT INTO ai_product_media (product_id, account_id, storage_path,
  mime_type, media_kind, file_size, created_at)
SELECT p.id, m.account_id, m.storage_path, m.mime_type, m.media_kind,
  m.file_size, m.created_at
FROM ai_media_library m
JOIN ai_products p
  ON p.account_id = m.account_id AND p.name = m.name
  AND p.created_at = m.created_at;

DROP TABLE ai_media_library;
```

(The join-back-by-name+created_at is a same-migration trick since both
inserts run in one transaction against a table with no existing
duplicate name+timestamp pairs — acceptable given today's actual data
is a single row; if any account has same-name/same-timestamp rows,
switch to a temp mapping table instead.) File labels start `NULL` for
every migrated row (no prior data to backfill them from).

### AI-facing changes

**`src/lib/ai/media-library.ts`**: `listMediaLibraryForPrompt` →
`listProductsForPrompt(db, accountId)`, returning one entry per
product with a nested `files: { id, label, mediaKind }[]`.
`getMediaLibraryItem` → `getProductMediaItem(db, accountId, fileId)`
(returns the file plus its parent product's `name`, for the
document-filename fallback). New `getProduct(db, accountId, productId)`
resolves a product by id (for tag application).

**`src/lib/ai/defaults.ts`** (`buildSystemPrompt`'s media section):
same two-sentinel design (`MEDIA_SENTINEL_*` for one file id,
`PRODUCT_TAG_SENTINEL_*` for one product id — both optional, both per
reply, unchanged), but:
- `mediaId` the model outputs is now a `product_media.id`.
- `productTagId` the model outputs is now an `ai_products.id`
  directly — no longer piggybacking on a file id.
- The listing format nests files under each product, e.g.:
  ```
  [abc123] Rollup Shutter door [estimated 350-1200 SAR/meter] -- Aluminum rollup shutters for windows... (options: motor +$50-80)
    - [def456] front view (image)
    - [ghi789] full catalog (document)
  ```
  No id-prefix scheme needed: product ids and file ids are both raw
  UUIDs from different tables (collision odds are the same as any two
  random UUIDs colliding, i.e. not a real concern), and the two
  sentinels already tell the model which id-space each one reads from
  — `MEDIA_SENTINEL_OPEN`/`CLOSE` always wraps a file id (one of the
  indented `[id]`s), `PRODUCT_TAG_SENTINEL_OPEN`/`CLOSE` always wraps
  a product id (the outer `[id]`).

**`src/lib/ai/auto-reply.ts`**: replace `getMediaLibraryItem(db,
accountId, mediaId)` with `getProductMediaItem(...)`; replace
`media.find((m) => m.id === productTagId)` (today, searching the flat
file list) with a lookup against the products list returned by
`listProductsForPrompt` (already in scope), matching on the product's
own id, then applying `tag_id` from that product — same
best-effort/never-blocks semantics as today.

**`src/app/api/ai/playground/route.ts`**: same swap — check current
usage of `listMediaLibraryForPrompt`/`getMediaLibraryItem` there and
update in step with `auto-reply.ts`.

### Settings UI

`src/components/settings/ai-media-library.tsx` →
`ai-product-library.tsx` (or keep the filename, rename the exported
component — implementer's call, low-stakes). List becomes one row per
product (name, price range, file count). Selecting a product for edit
shows today's info fields (name, description, price min/max/unit,
price notes, tag label) *without* the file picker, plus a nested files
section (label, kind icon, delete button) and an "Add file" action
that opens the existing upload control scoped to that product. A new
product saves with just info (the zero-file case). "Add file" appears
once the product has an id — i.e. after that first save, the form
stays open in edit mode and the same "Add file" action used for any
existing product becomes available.

Routes:
- `GET /api/ai/products`, `POST /api/ai/products` (info only, no file)
- `GET/PATCH/DELETE /api/ai/products/[id]` (`DELETE` cascades —
  removes all child `ai_product_media` rows via `ON DELETE CASCADE`,
  then best-effort GCs each one's storage object, same pattern as
  today's single-file `DELETE`)
- `POST /api/ai/products/[id]/media` (add one file; body = label +
  already-uploaded storage_path/mime_type/media_kind/file_size, same
  client-uploads-then-registers flow as today)
- `DELETE /api/ai/products/[id]/media/[fileId]` (remove one file +
  best-effort storage GC)
- `PATCH /api/ai/products/[id]/media/[fileId]` (edit a file's label
  only — everything else about a file is immutable)

Tag resolution (`resolveImportTagIds`, today in `POST /api/ai/media`)
moves to `POST /api/ai/products` and `PATCH /api/ai/products/[id]`,
keyed on `tag_label || name` (was `product_label || name`) —
same behavior, new field name.

### Inbox catalog picker

`src/components/inbox/catalog-picker-dialog.tsx`: add a `view: 'products' | 'files'` state (default `'products'`). Step 1 queries
`ai_products` (name, price range) directly via the Supabase client
(as it does today for `ai_media_library`), renders a list, tap → step
2 queries that product's `ai_product_media` rows (label, kind icon),
tap → same `onPick(item)` callback as today, closing the dialog. A
back chevron in the dialog header returns from step 2 to step 1.

### Tests

- `src/lib/ai/media-library.test.ts` → rewritten for
  `listProductsForPrompt`/`getProductMediaItem`/`getProduct`.
- `src/lib/ai/auto-reply.test.ts` — update fixtures from flat
  media-library rows to product+file fixtures; add a case proving
  `productTagId` resolves correctly when the tagged product has zero
  attachable files (a product-only tag flag, no file sent).
- `buildSystemPrompt`'s media section has no dedicated test file today
  (no `defaults.test.ts` exists) — add one alongside the other new
  test files if the implementer wants a snapshot of the new nested
  product/file listing format; not required to match existing
  coverage.
- New `src/app/api/ai/products/route.test.ts`,
  `.../[id]/route.test.ts`, and `.../[id]/media/route.test.ts`,
  written from scratch — `src/app/api/ai/media/` has no test files
  today, so there is nothing to port, only the new routes to cover.

## Rollout

Single migration + code change, no feature flag — today's production
data is one row in one account, so the backfill is low-risk and
reversible only by restoring from a pre-migration snapshot if
something goes wrong (standard for this codebase's migration style;
no rollback migration is authored, matching precedent).
