# AI Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-per-row `ai_media_library` table with `ai_products` (info, entered once) + `ai_product_media` (files, many per product), so a product's name/description/pricing is entered once and any number of files can be attached to it — fixing both retyped-info duplication and the `mediaId`/`productTagId` id-space coupling described in the spec.

**Architecture:** Two new Postgres tables (`ai_products`, `ai_product_media`) replace `ai_media_library` via a single migration with an in-place backfill (old `ai_media_library.id` values are reused as the new `ai_products.id`, so no fragile joins are needed). Every consumer — the AI prompt builder, the auto-reply dispatcher, the admin playground, the Settings library card, and the inbox's manual catalog picker — is updated in lockstep to read/write the new shape. The model-facing sentinel mechanism (`[[SEND_MEDIA:id]]` / `[[TAG_PRODUCT:id]]`) is unchanged in format; only what the ids reference changes (a file id, and a product id, respectively — previously both referenced the same file id).

**Tech Stack:** Next.js (App Router) API routes, Supabase Postgres + RLS, Vitest, next-intl.

## Global Constraints

- Migration file goes in `supabase/migrations/`, numbered `057_` (verify this is still the next free number before writing the file — `supabase/migrations/` ends at `056_profile_locale_pref.sql` and a stray second `053_` file as of this plan's writing; re-check with `ls supabase/migrations | sort` in case more have landed since).
- Apply the migration (Task 1) and merge/deploy every task in this plan together, in one continuous pass. Do **not** apply the migration from an isolated branch/worktree and leave `main` unmerged for an extended period — that exact sequence (migration 053_agent_waha_conversation_channels applied to the shared database from an unmerged worktree branch) caused a production outage fixed earlier this session. If executing this plan in a worktree, the worktree must be merged to `main` and redeployed promptly after the migration is applied, not left dangling.
- RLS on both new tables mirrors `ai_media_library`'s existing four policies exactly: `SELECT` = `is_account_member(account_id)`; `INSERT`/`UPDATE`/`DELETE` = `is_account_member(account_id, 'admin')`.
- No feature flag — this is a single atomic cutover, matching this codebase's existing migration style (see `053_price_range_estimate.sql`, `053_agent_waha_conversation_channels.sql` for precedent: schema + code land together, no dual-write period).
- `ai-media` storage bucket, `MEDIA_MAX_BYTES_BY_KIND`, `uploadAccountMedia`/`deleteAccountMedia` (`src/lib/storage/upload-media.ts`) are unchanged — files still live in the same bucket at the same account-scoped paths; only which DB table references them changes.
- Every new/changed string the **inbox catalog picker** shows must go through `next-intl` (`messages/en.json` + `messages/ar.json`, kept in parity — see `messages/locale-parity.test.ts`). The **Settings library card** (`ai-media-library.tsx`) keeps its existing hardcoded-English-string style — it was never migrated to next-intl and this plan does not expand its scope to do so.
- The settings card's file name (`ai-media-library.tsx`) and exported component name (`AiMediaLibraryCard`) stay as-is. Only its internal structure and the API routes it calls change. This is a deliberate scope decision (avoid unrelated rename/import churn across the codebase) — do not rename the file or component mid-plan.

---

## File Structure

**New:**
- `supabase/migrations/057_ai_product_catalog.sql` — schema + backfill + drop
- `src/app/api/ai/products/route.ts` — list/create products
- `src/app/api/ai/products/[id]/route.ts` — get/update/delete one product
- `src/app/api/ai/products/[id]/media/route.ts` — add a file to a product
- `src/app/api/ai/products/[id]/media/[fileId]/route.ts` — edit label / delete one file
- `src/app/api/ai/products/route.test.ts`
- `src/app/api/ai/products/[id]/route.test.ts`
- `src/app/api/ai/products/[id]/media/route.test.ts`
- `src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`

**Modified:**
- `src/lib/ai/media-library.ts` — rewritten: products + nested files, not flat file rows
- `src/lib/ai/media-library.test.ts` — rewritten to match
- `src/lib/ai/defaults.ts` — prompt section + `MediaPromptItem` type updated for nested files
- `src/lib/ai/auto-reply.ts` — swaps to the new lookups; `productTagId` now resolves against the products list directly
- `src/lib/ai/auto-reply.test.ts` — new mock branch + a test proving product-only tagging (zero files) works
- `src/app/api/ai/playground/route.ts` — swaps `listMediaLibraryForPrompt` → `listProductsForPrompt`
- `src/components/settings/ai-media-library.tsx` — rewritten: product list/form + nested file list
- `src/components/inbox/catalog-picker-dialog.tsx` — rewritten: two-step product → file picker
- `messages/en.json`, `messages/ar.json` — two new `Inbox.composer` keys

**Deleted:**
- `src/app/api/ai/media/route.ts`
- `src/app/api/ai/media/[id]/route.ts`

---

### Task 1: Migration — `ai_products` + `ai_product_media`, backfill, drop `ai_media_library`

**Files:**
- Create: `supabase/migrations/057_ai_product_catalog.sql`

**Interfaces:**
- Produces: tables `ai_products` (`id, account_id, created_by, name, description, tag_label, tag_id, price_min, price_max, price_unit, price_notes, created_at, updated_at`) and `ai_product_media` (`id, product_id, account_id, label, storage_path, mime_type, media_kind, file_size, created_at`), both RLS-protected. Every later task reads/writes these exact column names.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 057_ai_product_catalog.sql
--
-- Replaces the file-per-row ai_media_library (038, extended by 053)
-- with two tables: ai_products (name/description/pricing, entered
-- once per product) and ai_product_media (any number of files per
-- product, each with an optional short label). Fixes two problems
-- with the old shape: (1) a product with a photo AND a catalog PDF
-- needed its info retyped across two rows, and (2) the AI's
-- productTagId sentinel had no way to flag "this product is the
-- topic" independently of "this specific file" -- both referenced
-- the same flat-list id. See docs/superpowers/specs/
-- 2026-08-01-ai-product-catalog-design.md.
--
-- account_id is denormalized onto ai_product_media (not resolved via
-- a join through ai_products) so its RLS policies stay the same
-- shape as ai_media_library's today -- matching how contacts/
-- conversations already do account-scoped RLS in this schema.
--
-- tag_id keeps ai_media_library's exact FK
-- (ai_media_library_tag_id_fkey -> tags(id) ON DELETE SET NULL).
--
-- Backfill reuses each ai_media_library row's own id as the new
-- ai_products.id -- nothing else in the schema has a FK to
-- ai_media_library.id, so this is safe and avoids joining the two
-- inserts back together by name/timestamp.
--
-- Idempotent -- safe to run multiple times, EXCEPT the backfill
-- INSERT block, which only makes sense while ai_media_library still
-- exists; on a second run the table is already gone and the DO block
-- below no-ops (guarded by to_regclass).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL,
  tag_label text,
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

CREATE INDEX IF NOT EXISTS ai_products_account_id_idx
  ON ai_products (account_id);

ALTER TABLE ai_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_products_select ON ai_products;
CREATE POLICY ai_products_select ON ai_products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_products_insert ON ai_products;
CREATE POLICY ai_products_insert ON ai_products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_products_update ON ai_products;
CREATE POLICY ai_products_update ON ai_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_products_delete ON ai_products;
CREATE POLICY ai_products_delete ON ai_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_products_updated_at ON ai_products;
CREATE TRIGGER ai_products_updated_at
  BEFORE UPDATE ON ai_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_products_updated_at();

CREATE TABLE IF NOT EXISTS ai_product_media (
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

CREATE INDEX IF NOT EXISTS ai_product_media_product_id_idx
  ON ai_product_media (product_id);
CREATE INDEX IF NOT EXISTS ai_product_media_account_id_idx
  ON ai_product_media (account_id);

ALTER TABLE ai_product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_product_media_select ON ai_product_media;
CREATE POLICY ai_product_media_select ON ai_product_media FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_product_media_insert ON ai_product_media;
CREATE POLICY ai_product_media_insert ON ai_product_media FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_product_media_update ON ai_product_media;
CREATE POLICY ai_product_media_update ON ai_product_media FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_product_media_delete ON ai_product_media;
CREATE POLICY ai_product_media_delete ON ai_product_media FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Backfill + cutover. Guarded so re-running this migration after
-- ai_media_library is already gone is a safe no-op.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.ai_media_library') IS NOT NULL THEN
    INSERT INTO ai_products (id, account_id, created_by, name, description,
      tag_label, tag_id, price_min, price_max, price_unit, price_notes,
      created_at, updated_at)
    SELECT id, account_id, created_by, name, description,
      product_label, tag_id, price_min, price_max, price_unit, price_notes,
      created_at, updated_at
    FROM ai_media_library
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO ai_product_media (product_id, account_id, storage_path,
      mime_type, media_kind, file_size, created_at)
    SELECT id, account_id, storage_path, mime_type, media_kind, file_size,
      created_at
    FROM ai_media_library;

    DROP TABLE ai_media_library;
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration to the project's Supabase database**

Use the `mcp__supabase__apply_migration` tool with `project_id` = the
project id resolved via `mcp__supabase__list_projects` (this
codebase's project — confirm by matching the `ref` against the
`NEXT_PUBLIC_SUPABASE_URL` host in `.env.local` / the deployed app),
`name` = `ai_product_catalog`, and `query` = the SQL above.

- [ ] **Step 3: Verify the new tables and backfill**

Run via `mcp__supabase__execute_sql`:

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('ai_products','ai_product_media','ai_media_library');
```

Expected: `ai_products` and `ai_product_media` present, `ai_media_library` absent.

```sql
select p.id, p.name, p.tag_label, p.price_min, p.price_max,
  (select count(*) from ai_product_media m where m.product_id = p.id) as file_count
from ai_products p;
```

Expected: one row (today's single migrated item), `file_count = 1`,
`tag_label` = `'Rollup Shutter door'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/057_ai_product_catalog.sql
git commit -m "Add ai_products/ai_product_media tables, backfill from ai_media_library"
```

---

### Task 2: Delete the old `/api/ai/media` routes

These query `ai_media_library`, which Task 1 just dropped — leaving
them in place means a live 500 the moment anything hits them, so they
come out before anything else changes. The Settings card and inbox
picker both still call them until Tasks 10–11 land; that's fine within
this single continuous implementation pass (see Global Constraints).

**Files:**
- Delete: `src/app/api/ai/media/route.ts`
- Delete: `src/app/api/ai/media/[id]/route.ts`

**Interfaces:**
- Consumes: nothing (deletion).
- Produces: nothing — Tasks 7–9 add the replacement `/api/ai/products*` routes.

- [ ] **Step 1: Delete both files**

```bash
git rm src/app/api/ai/media/route.ts src/app/api/ai/media/\[id\]/route.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "Remove ai_media_library-backed /api/ai/media routes"
```

---

### Task 3: Rewrite `src/lib/ai/media-library.ts` for products + files

**Files:**
- Modify: `src/lib/ai/media-library.ts` (full rewrite)
- Modify: `src/lib/ai/media-library.test.ts` (full rewrite)

**Interfaces:**
- Produces (consumed by Tasks 4 and 6):
  - `interface ProductMediaFilePromptItem { id: string; label: string | null; mediaKind: 'image' | 'document' }`
  - `interface ProductPromptItem { id: string; name: string; description: string; tagId: string | null; priceMin: number | null; priceMax: number | null; priceUnit: string | null; priceNotes: string | null; files: ProductMediaFilePromptItem[] }`
  - `interface ProductMediaItem { id: string; productId: string; productName: string; label: string | null; storagePath: string; mimeType: string; mediaKind: 'image' | 'document' }`
  - `async function listProductsForPrompt(db: SupabaseClient, accountId: string): Promise<ProductPromptItem[]>`
  - `async function getProductMediaItem(db: SupabaseClient, accountId: string, fileId: string): Promise<ProductMediaItem | null>`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/ai/media-library.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listProductsForPrompt, getProductMediaItem } from './media-library'

function fakeListDb(opts: { rows?: unknown[] | null; error?: unknown }): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: opts.rows ?? null, error: opts.error ?? null }),
  }
  return chain as unknown as SupabaseClient
}

function fakeSingleDb(opts: { row?: unknown | null; error?: unknown }): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: opts.row ?? null, error: opts.error ?? null }),
  }
  return chain as unknown as SupabaseClient
}

describe('listProductsForPrompt', () => {
  it('maps a product with nested files to camelCase', async () => {
    const db = fakeListDb({
      rows: [
        {
          id: 'p-1',
          name: 'Rollup Shutter door',
          description: 'Aluminum rollup shutters',
          tag_id: 'tag-1',
          price_min: 350,
          price_max: 1200,
          price_unit: 'per_meter',
          price_notes: 'Motor add-on +$50-80',
          ai_product_media: [
            { id: 'f-1', label: 'front view', media_kind: 'image' },
            { id: 'f-2', label: null, media_kind: 'document' },
          ],
        },
      ],
    })
    const products = await listProductsForPrompt(db, 'acc-1')
    expect(products).toEqual([
      {
        id: 'p-1',
        name: 'Rollup Shutter door',
        description: 'Aluminum rollup shutters',
        tagId: 'tag-1',
        priceMin: 350,
        priceMax: 1200,
        priceUnit: 'per_meter',
        priceNotes: 'Motor add-on +$50-80',
        files: [
          { id: 'f-1', label: 'front view', mediaKind: 'image' },
          { id: 'f-2', label: null, mediaKind: 'document' },
        ],
      },
    ])
  })

  it('defaults price fields to null and files to [] when absent', async () => {
    const db = fakeListDb({
      rows: [
        {
          id: 'p-2',
          name: 'Pool fence',
          description: 'Safety fencing',
          tag_id: null,
          price_min: null,
          price_max: null,
          price_unit: null,
          price_notes: null,
          ai_product_media: null,
        },
      ],
    })
    const [product] = await listProductsForPrompt(db, 'acc-1')
    expect(product.priceMin).toBeNull()
    expect(product.files).toEqual([])
  })

  it('returns [] on a query error', async () => {
    const db = fakeListDb({ rows: null, error: new Error('boom') })
    expect(await listProductsForPrompt(db, 'acc-1')).toEqual([])
  })
})

describe('getProductMediaItem', () => {
  it('returns the file plus its parent product name', async () => {
    const db = fakeSingleDb({
      row: {
        id: 'f-1',
        product_id: 'p-1',
        label: 'front view',
        storage_path: 'library/f-1.jpg',
        mime_type: 'image/jpeg',
        media_kind: 'image',
        ai_products: { name: 'Rollup Shutter door' },
      },
    })
    const item = await getProductMediaItem(db, 'acc-1', 'f-1')
    expect(item).toEqual({
      id: 'f-1',
      productId: 'p-1',
      productName: 'Rollup Shutter door',
      label: 'front view',
      storagePath: 'library/f-1.jpg',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    })
  })

  it('returns null when the id does not exist', async () => {
    const db = fakeSingleDb({ row: null })
    expect(await getProductMediaItem(db, 'acc-1', 'missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/ai/media-library.test.ts`
Expected: FAIL — `listProductsForPrompt`/`getProductMediaItem` are not exported (old file still has `listMediaLibraryForPrompt`/`getMediaLibraryItem`).

- [ ] **Step 3: Rewrite the implementation**

Replace the full contents of `src/lib/ai/media-library.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Product catalog: lets the autonomous auto-reply bot naturally
// decide, mid-conversation, to attach a product photo or catalog
// file -- no scripted Flow/keyword trigger involved.
//
// A product's info (name, description, pricing) is entered once in
// ai_products; any number of files hang off it in ai_product_media.
// The catalog is small and curated, so unlike the knowledge base
// there's no ranking/retrieval step: the whole menu (every product,
// each with its files) is listed in the system prompt and the model
// picks at most one FILE, by id, to attach -- and independently, at
// most one PRODUCT, by id, to flag as the topic (see defaults.ts /
// generate.ts for the two sentinels). Each product may also carry a
// linked contact tag (`tagId`), applied when the model flags it as
// the topic, independently of whether it attaches a file.
// ============================================================

export interface ProductMediaFilePromptItem {
  id: string
  label: string | null
  mediaKind: 'image' | 'document'
}

export interface ProductPromptItem {
  id: string
  name: string
  description: string
  tagId: string | null
  /** Price range, in the account's default currency (migration 053,
   * carried over unchanged). When BOTH are set, the assistant may
   * share this as a caveated estimate (see defaults.ts); when either
   * is null, pricing for this product stays reference-only under the
   * absolute no-pricing rule, exactly as before. */
  priceMin: number | null
  priceMax: number | null
  /** Free-form unit label paired with the range -- 'per_meter',
   * 'per_item', 'per_kg', etc. */
  priceUnit: string | null
  /** Free-text addon/option pricing not captured by the range (e.g.
   * "Automatic +$60, manual included; motor add-on +$50-80").
   * Only ever surfaced alongside a configured range. */
  priceNotes: string | null
  files: ProductMediaFilePromptItem[]
}

export interface ProductMediaItem {
  id: string
  productId: string
  /** Parent product's name -- used as the WhatsApp document filename
   * fallback when the file itself has no distinguishing label. */
  productName: string
  label: string | null
  storagePath: string
  mimeType: string
  mediaKind: 'image' | 'document'
}

/**
 * List every product for the prompt, each with its files nested
 * underneath. Best-effort: any failure degrades to an empty list (no
 * attach/tag capability that turn) rather than throwing into the
 * auto-reply path.
 */
export async function listProductsForPrompt(
  db: SupabaseClient,
  accountId: string,
): Promise<ProductPromptItem[]> {
  try {
    const { data, error } = await db
      .from('ai_products')
      .select(
        'id, name, description, tag_id, price_min, price_max, price_unit, price_notes, ai_product_media(id, label, media_kind)',
      )
      .eq('account_id', accountId)
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      tagId: (row.tag_id as string | null) ?? null,
      priceMin: (row.price_min as number | null) ?? null,
      priceMax: (row.price_max as number | null) ?? null,
      priceUnit: (row.price_unit as string | null) ?? null,
      priceNotes: (row.price_notes as string | null) ?? null,
      files: (
        (row.ai_product_media as
          | { id: string; label: string | null; media_kind: 'image' | 'document' }[]
          | null) ?? []
      ).map((f) => ({
        id: f.id,
        label: f.label,
        mediaKind: f.media_kind,
      })),
    }))
  } catch (err) {
    console.error('[ai product catalog] listProductsForPrompt failed:', err)
    return []
  }
}

/**
 * Full record for the file the model picked, used to build the actual
 * Meta media send (storage path -> public URL, MIME/kind for the
 * WhatsApp payload, product name for the document-filename fallback).
 * Null when the id doesn't exist (deleted mid-conversation, or --
 * since the model is instructed never to invent one -- a hallucinated
 * id).
 */
export async function getProductMediaItem(
  db: SupabaseClient,
  accountId: string,
  fileId: string,
): Promise<ProductMediaItem | null> {
  try {
    const { data, error } = await db
      .from('ai_product_media')
      .select('id, product_id, label, storage_path, mime_type, media_kind, ai_products(name)')
      .eq('account_id', accountId)
      .eq('id', fileId)
      .maybeSingle()
    if (error || !data) return null
    const product = data.ai_products as { name: string } | null
    return {
      id: data.id as string,
      productId: data.product_id as string,
      productName: product?.name ?? '',
      label: (data.label as string | null) ?? null,
      storagePath: data.storage_path as string,
      mimeType: data.mime_type as string,
      mediaKind: data.media_kind as 'image' | 'document',
    }
  } catch (err) {
    console.error('[ai product catalog] getProductMediaItem failed:', err)
    return null
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/ai/media-library.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/media-library.ts src/lib/ai/media-library.test.ts
git commit -m "Rewrite media-library.ts for grouped products + files"
```

---

### Task 4: Update `src/lib/ai/defaults.ts` prompt section for nested products/files

**Files:**
- Modify: `src/lib/ai/defaults.ts:114-131` (the `MediaPromptItem` interface)
- Modify: `src/lib/ai/defaults.ts:254-278` (the media-library prompt block inside `buildSystemPrompt`)

**Interfaces:**
- Consumes: `ProductPromptItem`/`ProductMediaFilePromptItem` shape from Task 3 (structurally — `defaults.ts` does not import from `media-library.ts`, it declares its own compatible interface, same as today).
- Produces: `buildSystemPrompt({ ..., media: MediaPromptItem[] })` — the `media` param name is unchanged (minimizes blast radius elsewhere in this file); its element shape changes to include `files`.

- [ ] **Step 1: Replace the `MediaPromptItem` interface**

In `src/lib/ai/defaults.ts`, replace lines 114–131:

```ts
/** One media-library item as fed into the auto-reply system prompt. */
export interface MediaPromptItem {
  id: string
  name: string
  productLabel: string | null
  description: string
  /** When BOTH are set (migration 053), the model may share this range
   * as a caveated estimate instead of the usual absolute no-pricing
   * rule -- see the media-library prompt block below. When either is
   * null, pricing for this item is reference-only exactly like before:
   * never quoted, only used to ask the right clarifying question. */
  priceMin?: number | null
  priceMax?: number | null
  priceUnit?: string | null
  /** Free-text addon/option pricing not captured by the range (e.g.
   * "Automatic +$60, manual included; motor add-on +$50-80",
   * migration 053). Only ever surfaced alongside a configured range --
   * never as a standalone estimate. */
  priceNotes?: string | null
}
```

with:

```ts
/** One file nested under a product in the auto-reply system prompt. */
export interface MediaPromptFileItem {
  id: string
  label: string | null
  mediaKind: 'image' | 'document'
}

/** One product (with its files) as fed into the auto-reply system
 * prompt. Replaces the old flat file-per-row shape -- a product's
 * info is listed once, with any number of files nested under it. */
export interface MediaPromptItem {
  id: string
  name: string
  description: string
  /** When BOTH are set, the model may share this range as a caveated
   * estimate instead of the usual absolute no-pricing rule -- see the
   * media-library prompt block below. When either is null, pricing
   * for this product is reference-only exactly like before: never
   * quoted, only used to ask the right clarifying question. */
  priceMin?: number | null
  priceMax?: number | null
  priceUnit?: string | null
  /** Free-text addon/option pricing not captured by the range (e.g.
   * "Automatic +$60, manual included; motor add-on +$50-80"). Only
   * ever surfaced alongside a configured range -- never as a
   * standalone estimate. */
  priceNotes?: string | null
  files: MediaPromptFileItem[]
}
```

- [ ] **Step 2: Replace the media-library prompt block**

Replace lines 254–278 (the `if (mode === 'auto_reply' && media && media.length > 0) { ... }` block):

```ts
  if (mode === 'auto_reply' && media && media.length > 0) {
    parts.push(
      'Product catalog -- products you may reference, and files (photos / catalog documents) you may attach to your reply. Listed as `[product id] name [pricing info, if any] -- description`, with each product\'s files indented underneath as `- [file id] label (image|document)`. ' +
        `Attach AT MOST ONE FILE, only when the customer's request clearly matches one: end your reply with ${MEDIA_SENTINEL_OPEN}id${MEDIA_SENTINEL_CLOSE}, using the exact FILE id shown on one of the indented lines (never a product id, never invent or guess an id). A product with no files listed beneath it has nothing to attach -- you can still discuss or tag it, just never emit a media marker for it. ` +
        `Independently of attaching a file, whenever a specific product from this list is clearly the topic of the conversation -- the customer is asking about it, comparing it, or showing interest in it, even if you don't attach anything -- also add ${PRODUCT_TAG_SENTINEL_OPEN}id${PRODUCT_TAG_SENTINEL_CLOSE} using that product's own id (the outer, unindented id, never a file id), so the business can track the contact's interest. You may include both markers, only one, or neither. ` +
        'The customer never sees these markers -- they are stripped before sending and the matching file (if any) is attached automatically. ' +
        "When a product's pricing shows only a unit (e.g. \"per meter\") with no range, that is for YOUR reference only, to ask the right clarifying question (e.g. a per-meter product -> ask how many meters) -- it is NOT permission to state a number; the absolute no-pricing rule above still applies. " +
        'When a product\'s pricing shows an estimated range (e.g. "estimated 80-120 per meter"), you MAY share that range with the customer as a clearly-labeled estimate -- always say it is an estimate and that the final price is confirmed by the team, never state it as a confirmed final number, and never state a number outside the shown range. If the product also lists addon/option notes (e.g. "options: automatic +$60, custom colors +$20"), you may reference those the same way, as part of the same estimate -- never as a separate confirmed price. Sharing an estimate does not require a handoff; keep the conversation going normally afterward. ' +
        'If nothing clearly matches, do not attach anything and do not mention any marker.\n\n' +
        media
          .map((m) => {
            const unit = m.priceUnit ? m.priceUnit.replace(/_/g, ' ') : null
            const hasRange = m.priceMin != null && m.priceMax != null
            const unitSuffix = unit ? ' ' + unit : ''
            const pricing = hasRange
              ? ' [estimated ' + m.priceMin + '-' + m.priceMax + unitSuffix + ']'
              : unit
                ? ' [priced ' + unit + ']'
                : ''
            const notes = hasRange && m.priceNotes ? ` (options: ${m.priceNotes})` : ''
            const fileLines = m.files
              .map((f) => `  - [${f.id}] ${f.label ? f.label + ' ' : ''}(${f.mediaKind})`)
              .join('\n')
            const header = `[${m.id}] ${m.name}${pricing} -- ${m.description}${notes}`
            return fileLines ? `${header}\n${fileLines}` : header
          })
          .join('\n'),
    )
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this file has no dedicated test; Task 5 exercises it indirectly through `auto-reply.ts`'s real call site, and manual review below confirms correctness).

- [ ] **Step 4: Manually sanity-check the prompt text**

Run this ad-hoc script and read the output — confirms the nested
format and sentinel wording read correctly for a two-file product and
a zero-file product:

```bash
npx tsx -e "
import { buildSystemPrompt } from './src/lib/ai/defaults'
console.log(buildSystemPrompt({
  userPrompt: null,
  mode: 'auto_reply',
  media: [
    {
      id: 'p-1', name: 'Rollup Shutter door', description: 'Aluminum rollup shutters',
      priceMin: 350, priceMax: 1200, priceUnit: 'per_meter', priceNotes: 'Motor add-on +\$50-80',
      files: [
        { id: 'f-1', label: 'front view', mediaKind: 'image' },
        { id: 'f-2', label: null, mediaKind: 'document' },
      ],
    },
    { id: 'p-2', name: 'Pool fence', description: 'Safety fencing', files: [] },
  ],
}))
"
```

Expected: output includes a `Product catalog --` section listing
`[p-1] Rollup Shutter door [estimated 350-1200 per_meter] -- ...`
with two indented `- [f-1] front view (image)` / `- [f-2] (document)`
lines beneath it, and `[p-2] Pool fence -- Safety fencing` with no
indented lines beneath it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/defaults.ts
git commit -m "Update auto-reply prompt for nested product/file catalog"
```

---

### Task 5: Update `src/lib/ai/auto-reply.ts` + its tests

**Files:**
- Modify: `src/lib/ai/auto-reply.ts:6, 253, 444-491`
- Modify: `src/lib/ai/auto-reply.test.ts`

**Interfaces:**
- Consumes: `listProductsForPrompt`, `getProductMediaItem` from Task 3; `addContactTagAndDispatch` from `@/lib/contacts/tag-events` (unchanged signature).
- Produces: nothing new — internal dispatcher behavior only.

- [ ] **Step 1: Update the import**

In `src/lib/ai/auto-reply.ts:6`, replace:

```ts
import { listMediaLibraryForPrompt, getMediaLibraryItem } from './media-library'
```

with:

```ts
import { listProductsForPrompt, getProductMediaItem } from './media-library'
```

- [ ] **Step 2: Update the fetch call**

At `src/lib/ai/auto-reply.ts:253` (inside `dispatchInboundToAiReply`), replace:

```ts
    const media = await listMediaLibraryForPrompt(db, accountId)
```

with:

```ts
    const media = await listProductsForPrompt(db, accountId)
```

(Variable name `media` is kept — it's still passed straight into `buildSystemPrompt({ ..., media })` unchanged, and renaming it would touch that call site for no behavioral gain.)

- [ ] **Step 3: Update the media-attach block**

Replace the media-attach `if (mediaId) { ... }` block (currently
`src/lib/ai/auto-reply.ts:444-469`):

```ts
    if (mediaId) {
      try {
        const item = await getMediaLibraryItem(db, accountId, mediaId)
        if (item) {
          const {
            data: { publicUrl },
          } = db.storage.from('ai-media').getPublicUrl(item.storagePath)
          await engineSendMedia({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            kind: item.mediaKind,
            link: publicUrl,
            filename: item.mediaKind === 'document' ? item.name : undefined,
          })
        } else {
          console.warn(
            `[ai auto-reply] model chose media id "${mediaId}" but it no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] media send failed:', err)
      }
    }
```

with:

```ts
    if (mediaId) {
      try {
        const item = await getProductMediaItem(db, accountId, mediaId)
        if (item) {
          const {
            data: { publicUrl },
          } = db.storage.from('ai-media').getPublicUrl(item.storagePath)
          await engineSendMedia({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            kind: item.mediaKind,
            link: publicUrl,
            filename: item.mediaKind === 'document' ? (item.label || item.productName) : undefined,
          })
        } else {
          console.warn(
            `[ai auto-reply] model chose file id "${mediaId}" but it no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] media send failed:', err)
      }
    }
```

(`filename` falls back to the file's own `label` before the parent
product's `name` — today's code always used the flat row's `name`
since that WAS the file's own title; now a file may have no label, so
fall back to the product name it belongs to.)

- [ ] **Step 4: Update the product-tag block**

Replace the product-tag `if (productTagId) { ... }` block (currently
`src/lib/ai/auto-reply.ts:475-491`):

```ts
    if (productTagId) {
      try {
        const taggedItem = media.find((m) => m.id === productTagId)
        if (taggedItem?.tagId) {
          await addContactTagAndDispatch({
            db,
            accountId,
            contactId,
            tagId: taggedItem.tagId,
          })
        } else {
          console.warn(
            `[ai auto-reply] model flagged product id "${productTagId}" but it has no linked tag or no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] product tag failed:', err)
      }
    }
```

This block's logic is unchanged (`media` now holds products directly,
each with its own `id`/`tagId`, so `media.find((m) => m.id ===
productTagId)` already resolves correctly against the new shape —
only the comment above it needs a word fixed, from "media-library id"
to "product id", matching the updated type doc in Task 4):

```ts
    if (productTagId) {
      try {
        const taggedProduct = media.find((m) => m.id === productTagId)
        if (taggedProduct?.tagId) {
          await addContactTagAndDispatch({
            db,
            accountId,
            contactId,
            tagId: taggedProduct.tagId,
          })
        } else {
          console.warn(
            `[ai auto-reply] model flagged product id "${productTagId}" but it has no linked tag or no longer exists for account ${accountId}.`,
          )
        }
      } catch (err) {
        console.error('[ai auto-reply] product tag failed:', err)
      }
    }
```

- [ ] **Step 5: Also update the two comment blocks above these**

Just above the media-attach block (`// Best-effort media attach: ...`)
and the product-tag block (`// Best-effort product tag: ...`), both
currently say "a real, existing library id" / "media-library id" —
update to "a real, existing file id" and "product id" respectively, to
match. (Cosmetic only; skip if short on time, but keep the code
changes above.)

- [ ] **Step 6: Add the mock branch + new test case**

`vitest.config.ts` has `clearMocks: true`, so every `vi.fn()`'s call
history is cleared automatically before each test — no manual
`.mockClear()` needed for the new mock added below. Plain `h.state.*`
properties are NOT covered by that (they're not mock functions), so
`h.state.products` does need adding to the existing `beforeEach`
reset block, matching how `h.state.autoResponders` etc. already are.

In `src/lib/ai/auto-reply.test.ts:5-26`, the hoisted `h` object,
change:

```ts
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    account: null as Record<string, unknown> | null,
    admins: [] as { user_id: string }[],
    agentProfile: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    conversationUpdates: [] as Record<string, unknown>[],
    notificationInserts: [] as Record<string, unknown>[],
    rpcCalls: [] as { name: string; args: unknown }[],
    existingAiNote: null as Record<string, unknown> | null,
    noteInserts: [] as Record<string, unknown>[],
    noteUpdates: [] as Record<string, unknown>[],
  },
}))
```

to:

```ts
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  addContactTagAndDispatch: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    account: null as Record<string, unknown> | null,
    admins: [] as { user_id: string }[],
    agentProfile: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    products: [] as Record<string, unknown>[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    conversationUpdates: [] as Record<string, unknown>[],
    notificationInserts: [] as Record<string, unknown>[],
    rpcCalls: [] as { name: string; args: unknown }[],
    existingAiNote: null as Record<string, unknown> | null,
    noteInserts: [] as Record<string, unknown>[],
    noteUpdates: [] as Record<string, unknown>[],
  },
}))
```

At `src/lib/ai/auto-reply.test.ts:32`, right after the existing
`vi.mock('@/lib/flows/meta-send', ...)` line, add:

```ts
vi.mock('@/lib/contacts/tag-events', () => ({ addContactTagAndDispatch: h.addContactTagAndDispatch }))
```

Inside the `vi.mock('./admin-client', ...)` factory's `from: (table:
string) => { ... }` switch (`src/lib/ai/auto-reply.test.ts:35-97`, the
block already handling `'automations'`, `'accounts'`, `'profiles'`,
`'notifications'`, `'contact_notes'`), add a new branch — place it
right after the `'contact_notes'` branch closes (before the final
`// conversations` fallback `return`, i.e. right before line 98's
`// conversations` comment):

```ts
      if (table === 'ai_products') {
        // .select(...).eq('account_id', accountId) -> listProductsForPrompt
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: h.state.products, error: null }),
          }),
        }
      }
```

In the `beforeEach` block (`src/lib/ai/auto-reply.test.ts:151-181`),
add `h.state.products = []` on its own line next to the other
`h.state.*` resets (e.g. right after `h.state.autoResponders = []`).

Finally, add this test as a new sibling inside the existing `describe('dispatchInboundToAiReply — eligibility gates', ...)` block (`src/lib/ai/auto-reply.test.ts:183-269`), right after the `'claims a slot and sends on the happy path'` test — it reuses the same shared `ARGS` constant and relies on `beforeEach`'s defaults for everything except what it explicitly sets, exactly like every other test in this file:

```ts
  it('applies a product tag when the model flags a product with zero attachable files, without attaching anything', async () => {
    h.state.products = [
      {
        id: 'prod-1',
        name: 'Pool fence',
        description: 'Safety fencing',
        tag_id: 'tag-1',
        price_min: null,
        price_max: null,
        price_unit: null,
        price_notes: null,
        ai_product_media: [],
      },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Sure, let me get you details on our pool fencing.',
      handoff: false,
      mediaId: null,
      productTagId: 'prod-1',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-1', contactId: 'contact-1', tagId: 'tag-1' }),
    )
  })
```

(Uses the file's real `ARGS` constant — `accountId: 'acct-1'`,
`contactId: 'contact-1'` — from `src/lib/ai/auto-reply.test.ts:122-127`,
not placeholder ids. `generateReply`'s mock only sets the fields this
test cares about, matching every other test's minimal-override style,
e.g. the default in `beforeEach` is just `{ text: 'Hello!', handoff:
false }`.)

(Match this test's setup — `h.state.conv`, `h.state.account`, etc. —
to whatever the neighboring passing test in this file already
establishes as the minimum fixture for a dispatch to reach the
`generateReply` call; copy that setup rather than guessing, since the
exact required fields depend on the current file's fixture helpers.)

Import `dispatchInboundToAiReply` at the top of the test file if it
isn't already (check the existing `import` line — the file already
tests this function, so it should already be imported).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lib/ai/auto-reply.test.ts`
Expected: PASS, including the new test.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/auto-reply.ts src/lib/ai/auto-reply.test.ts
git commit -m "Wire auto-reply dispatcher to product/file catalog"
```

---

### Task 6: Update `src/app/api/ai/playground/route.ts`

**Files:**
- Modify: `src/app/api/ai/playground/route.ts:6, 83`

**Interfaces:**
- Consumes: `listProductsForPrompt` from Task 3.

- [ ] **Step 1: Update the import and call site**

Replace line 6:

```ts
import { listMediaLibraryForPrompt } from '@/lib/ai/media-library'
```

with:

```ts
import { listProductsForPrompt } from '@/lib/ai/media-library'
```

Replace line 83:

```ts
    const media = await listMediaLibraryForPrompt(supabase, accountId)
```

with:

```ts
    const media = await listProductsForPrompt(supabase, accountId)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ai/playground/route.ts
git commit -m "Point AI playground route at product catalog"
```

---

### Task 7: `GET/POST /api/ai/products`

**Files:**
- Create: `src/app/api/ai/products/route.ts`
- Create: `src/app/api/ai/products/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentAccount`, `requireRole`, `toErrorResponse` (`@/lib/auth/account`); `checkRateLimit`, `rateLimitResponse`, `RATE_LIMITS` (`@/lib/rate-limit`); `resolveImportTagIds` (`@/lib/contacts/resolve-import-tags`) — all with the same signatures used by the old `/api/ai/media` route (Task 2 deleted it, but the signatures are unchanged elsewhere in the codebase).
- Produces: `GET` → `{ items: Product[] }` where `Product = { id, name, description, tag_label, price_min, price_max, price_unit, price_notes, updated_at, files: { id, label, media_kind, mime_type, storage_path }[] }`. `POST` → `{ success: true, id }`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'

/**
 * GET /api/ai/products
 *
 * List the account's products, each with its nested files (any
 * member). Used by the product-catalog settings card and the inbox's
 * manual catalog picker.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_products')
      .select(
        'id, name, description, tag_label, price_min, price_max, price_unit, price_notes, updated_at, ai_product_media(id, label, media_kind, mime_type, storage_path)',
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[ai/products GET] error:', error)
      return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
    }
    const items = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      tag_label: row.tag_label,
      price_min: row.price_min,
      price_max: row.price_max,
      price_unit: row.price_unit,
      price_notes: row.price_notes,
      updated_at: row.updated_at,
      files: row.ai_product_media ?? [],
    }))
    return NextResponse.json({ items })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/products (admin+)
 *
 * Create a product with just its info -- no file required (files are
 * added afterward via POST /api/ai/products/[id]/media). Also
 * resolves (find-or-create) a contact tag named after the product --
 * `tag_label` if set, else `name` -- so the auto-reply bot can apply
 * it to a contact when this product is clearly the topic of
 * conversation (see PRODUCT_TAG_SENTINEL_* in lib/ai/defaults.ts).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-products:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description =
      typeof body?.description === 'string' ? body.description.trim() : ''
    const tagLabel =
      typeof body?.tag_label === 'string' ? body.tag_label.trim() : ''
    const priceMin =
      typeof body?.price_min === 'number' && Number.isFinite(body.price_min)
        ? body.price_min
        : null
    const priceMax =
      typeof body?.price_max === 'number' && Number.isFinite(body.price_max)
        ? body.price_max
        : null
    const priceUnit =
      typeof body?.price_unit === 'string' && body.price_unit.trim()
        ? body.price_unit.trim()
        : null
    const priceNotes =
      typeof body?.price_notes === 'string' && body.price_notes.trim()
        ? body.price_notes.trim()
        : null

    if (priceMin !== null && priceMax !== null && priceMax < priceMin) {
      return NextResponse.json(
        { error: 'price_max must be greater than or equal to price_min' },
        { status: 400 },
      )
    }

    if (!name || !description) {
      return NextResponse.json(
        { error: 'name and description are required' },
        { status: 400 },
      )
    }

    let tagId: string | null = null
    const tagName = tagLabel || name
    try {
      const { tagIdByKey } = await resolveImportTagIds(supabase, {
        accountId,
        userId,
        tagNames: [tagName],
        canCreateTags: true,
      })
      tagId = tagIdByKey.get(tagName.toLowerCase()) ?? null
    } catch (err) {
      console.error('[ai/products POST] tag resolution failed:', err)
    }

    const { data: item, error } = await supabase
      .from('ai_products')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        description,
        tag_label: tagLabel || null,
        tag_id: tagId,
        price_min: priceMin,
        price_max: priceMax,
        price_unit: priceUnit,
        price_notes: priceNotes,
      })
      .select('id')
      .single()
    if (error || !item) {
      console.error('[ai/products POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to save product' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: item.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  resolveImportTagIds: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds: h.resolveImportTagIds,
}))

import { GET, POST } from './route'

function fakeSupabase(opts: {
  listData?: unknown[] | null
  listError?: unknown
  insertData?: unknown
  insertError?: unknown
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({ data: opts.listData ?? null, error: opts.listError ?? null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({ data: opts.insertData ?? null, error: opts.insertError ?? null }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('GET /api/ai/products', () => {
  it('lists products with nested files', async () => {
    h.getCurrentAccount.mockResolvedValue({
      supabase: fakeSupabase({
        listData: [
          {
            id: 'p-1',
            name: 'Rollup Shutter door',
            description: 'Aluminum rollup shutters',
            tag_label: 'Shutters',
            price_min: 350,
            price_max: 1200,
            price_unit: 'per_meter',
            price_notes: null,
            updated_at: '2026-08-01T00:00:00Z',
            ai_product_media: [{ id: 'f-1', label: 'front', media_kind: 'image', mime_type: 'image/jpeg', storage_path: 'x' }],
          },
        ],
      }),
      accountId: 'acc-1',
    })
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].files).toHaveLength(1)
  })
})

describe('POST /api/ai/products', () => {
  it('rejects a price range with max < min', async () => {
    h.requireRole.mockResolvedValue({ supabase: fakeSupabase({}), accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', description: 'Y', price_min: 350, price_max: 120 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('creates a product with no files and resolves a tag', async () => {
    h.requireRole.mockResolvedValue({
      supabase: fakeSupabase({ insertData: { id: 'p-new' } }),
      accountId: 'acc-1',
      userId: 'u-1',
    })
    h.resolveImportTagIds.mockResolvedValue({ tagIdByKey: new Map([['pool fence', 'tag-9']]) })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pool fence', description: 'Safety fencing' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, id: 'p-new' })
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/app/api/ai/products/route.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/products/route.ts src/app/api/ai/products/route.test.ts
git commit -m "Add GET/POST /api/ai/products"
```

---

### Task 8: `GET/PATCH/DELETE /api/ai/products/[id]`

**Files:**
- Create: `src/app/api/ai/products/[id]/route.ts`
- Create: `src/app/api/ai/products/[id]/route.test.ts`

**Interfaces:**
- Consumes: same imports as Task 7's route.
- Produces: `DELETE` cascades to `ai_product_media` (via `ON DELETE CASCADE`, Task 1), then best-effort GCs each removed file's storage object.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/products/[id] -- full product + files (any member).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data, error } = await supabase
      .from('ai_products')
      .select(
        'id, name, description, tag_label, price_min, price_max, price_unit, price_notes, updated_at, ai_product_media(id, label, media_kind, mime_type, storage_path)',
      )
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[ai/products/[id] GET] error:', error)
      return NextResponse.json({ error: 'Failed to load product' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      ...data,
      files: data.ai_product_media ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/products/[id] (admin+) -- edit info fields. Files are
 * managed separately (see [id]/media). Whenever name or tag_label
 * changes, the linked contact tag is re-resolved (find-or-create) so
 * it stays in sync -- same logic as POST's create path.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)

    const update: Record<string, string | number | null> = {}
    if (typeof body?.name === 'string') update.name = body.name.trim()
    if (typeof body?.description === 'string') update.description = body.description.trim()
    if (typeof body?.tag_label === 'string' || body?.tag_label === null) {
      update.tag_label =
        typeof body.tag_label === 'string' && body.tag_label.trim()
          ? body.tag_label.trim()
          : null
    }
    if ('price_min' in (body ?? {})) {
      update.price_min =
        typeof body.price_min === 'number' && Number.isFinite(body.price_min)
          ? body.price_min
          : null
    }
    if ('price_max' in (body ?? {})) {
      update.price_max =
        typeof body.price_max === 'number' && Number.isFinite(body.price_max)
          ? body.price_max
          : null
    }
    if (typeof body?.price_unit === 'string' || body?.price_unit === null) {
      update.price_unit =
        typeof body.price_unit === 'string' && body.price_unit.trim()
          ? body.price_unit.trim()
          : null
    }
    if (typeof body?.price_notes === 'string' || body?.price_notes === null) {
      update.price_notes =
        typeof body.price_notes === 'string' && body.price_notes.trim()
          ? body.price_notes.trim()
          : null
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    {
      const nextMin = 'price_min' in update ? update.price_min : undefined
      const nextMax = 'price_max' in update ? update.price_max : undefined
      if (typeof nextMin === 'number' && typeof nextMax === 'number' && nextMax < nextMin) {
        return NextResponse.json(
          { error: 'price_max must be greater than or equal to price_min' },
          { status: 400 },
        )
      }
    }
    if ('name' in update && !update.name) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    if ('description' in update && !update.description) {
      return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
    }

    if ('name' in update || 'tag_label' in update) {
      try {
        const { data: current } = await supabase
          .from('ai_products')
          .select('name, tag_label')
          .eq('account_id', accountId)
          .eq('id', id)
          .maybeSingle()
        const effectiveName = 'name' in update ? update.name : current?.name ?? null
        const effectiveLabel =
          'tag_label' in update ? update.tag_label : current?.tag_label ?? null
        const tagName = effectiveLabel || effectiveName
        if (tagName) {
          const { tagIdByKey } = await resolveImportTagIds(supabase, {
            accountId,
            userId,
            tagNames: [tagName],
            canCreateTags: true,
          })
          update.tag_id = tagIdByKey.get(tagName.toLowerCase()) ?? null
        }
      } catch (err) {
        console.error('[ai/products/[id] PATCH] tag resolution failed:', err)
      }
    }

    const { data: updated, error } = await supabase
      .from('ai_products')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/products/[id] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update product' }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/products/[id] (admin+) -- removes the product row
 * (ai_product_media rows cascade via FK), then best-effort GCs each
 * removed file's underlying storage object so nothing lingers in the
 * public `ai-media` bucket.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { data: files } = await supabase
      .from('ai_product_media')
      .select('storage_path')
      .eq('account_id', accountId)
      .eq('product_id', id)

    const { error } = await supabase
      .from('ai_products')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/products/[id] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 })
    }

    const paths = (files ?? []).map((f) => f.storage_path as string).filter(Boolean)
    if (paths.length > 0) {
      await supabase.storage.from('ai-media').remove(paths)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  resolveImportTagIds: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds: h.resolveImportTagIds,
}))

import { GET, PATCH, DELETE } from './route'

beforeEach(() => vi.clearAllMocks())

describe('DELETE /api/ai/products/[id]', () => {
  it('deletes the product and GCs its files from storage', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = {
      from: (table: string) => {
        if (table === 'ai_product_media') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ data: [{ storage_path: 'library/f-1.jpg' }], error: null }),
              }),
            }),
          }
        }
        return {
          delete: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        }
      },
      storage: { from: () => ({ remove }) },
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const res = await DELETE(new Request('http://x'), { params: Promise.resolve({ id: 'p-1' }) })
    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(['library/f-1.jpg'])
  })
})

describe('PATCH /api/ai/products/[id]', () => {
  it('returns 404 when the product is not in this account', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'New name' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/ai/products/[id]', () => {
  it('returns 404 when not found', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }
    h.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/app/api/ai/products/[id]/route.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/products/\[id\]/route.ts src/app/api/ai/products/\[id\]/route.test.ts
git commit -m "Add GET/PATCH/DELETE /api/ai/products/[id]"
```

---

### Task 9: `POST /api/ai/products/[id]/media` and `PATCH/DELETE /api/ai/products/[id]/media/[fileId]`

**Files:**
- Create: `src/app/api/ai/products/[id]/media/route.ts`
- Create: `src/app/api/ai/products/[id]/media/[fileId]/route.ts`
- Create: `src/app/api/ai/products/[id]/media/route.test.ts`
- Create: `src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`

**Interfaces:**
- Consumes: same auth/rate-limit imports as prior route tasks.
- Produces: `POST .../media` → `{ success: true, id }`; `PATCH .../media/[fileId]` → `{ success: true }`; `DELETE .../media/[fileId]` → `{ success: true }` + best-effort storage GC.

- [ ] **Step 1: Write `src/app/api/ai/products/[id]/media/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/ai/products/[id]/media (admin+)
 *
 * Register a file whose upload has ALREADY happened to the `ai-media`
 * storage bucket by the client (see uploadAccountMedia /
 * MEDIA_MAX_BYTES_BY_KIND) -- mirrors the old /api/ai/media POST's
 * upload-then-register flow, now scoped under a product.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-products-media:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id: productId } = await params
    const body = await request.json().catch(() => null)
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    const storagePath = typeof body?.storage_path === 'string' ? body.storage_path.trim() : ''
    const mimeType = typeof body?.mime_type === 'string' ? body.mime_type.trim() : ''
    const mediaKind =
      body?.media_kind === 'document' || body?.media_kind === 'image' ? body.media_kind : ''
    const fileSize = typeof body?.file_size === 'number' ? body.file_size : null

    if (!storagePath || !mimeType || !mediaKind) {
      return NextResponse.json(
        { error: 'storage_path, mime_type, and media_kind are required' },
        { status: 400 },
      )
    }

    const { data: product } = await supabase
      .from('ai_products')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', productId)
      .maybeSingle()
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { data: item, error } = await supabase
      .from('ai_product_media')
      .insert({
        product_id: productId,
        account_id: accountId,
        label: label || null,
        storage_path: storagePath,
        mime_type: mimeType,
        media_kind: mediaKind,
        file_size: fileSize,
      })
      .select('id')
      .single()
    if (error || !item) {
      console.error('[ai/products/[id]/media POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: item.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Write `src/app/api/ai/products/[id]/media/[fileId]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type Params = { params: Promise<{ id: string; fileId: string }> }

/**
 * PATCH /api/ai/products/[id]/media/[fileId] (admin+) -- edit a
 * file's label only. Everything else about a file (its storage
 * object, MIME type, kind) is immutable -- delete and re-add instead.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { fileId } = await params
    const body = await request.json().catch(() => null)
    if (typeof body?.label !== 'string' && body?.label !== null) {
      return NextResponse.json({ error: "'label' must be a string or null" }, { status: 400 })
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null

    const { data: updated, error } = await supabase
      .from('ai_product_media')
      .update({ label })
      .eq('account_id', accountId)
      .eq('id', fileId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/products/[id]/media/[fileId] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/products/[id]/media/[fileId] (admin+) -- removes the
 * DB row, then best-effort GCs the underlying storage object.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { fileId } = await params

    const { data: row } = await supabase
      .from('ai_product_media')
      .select('storage_path')
      .eq('account_id', accountId)
      .eq('id', fileId)
      .maybeSingle()

    const { error } = await supabase
      .from('ai_product_media')
      .delete()
      .eq('account_id', accountId)
      .eq('id', fileId)
    if (error) {
      console.error('[ai/products/[id]/media/[fileId] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
    }

    if (row?.storage_path) {
      await supabase.storage.from('ai-media').remove([row.storage_path])
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 3: Write `src/app/api/ai/products/[id]/media/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireRole: vi.fn(), checkRateLimit: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('POST /api/ai/products/[id]/media', () => {
  it('404s when the product does not exist in this account', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ storage_path: 'p', mime_type: 'image/jpeg', media_kind: 'image' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('adds a file to an existing product', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'ai_products') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'p-1' }, error: null }),
                }),
              }),
            }),
          }
        }
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'f-new' }, error: null }),
            }),
          }),
        }
      },
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ label: 'front view', storage_path: 'p', mime_type: 'image/jpeg', media_kind: 'image' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'p-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, id: 'f-new' })
  })
})
```

- [ ] **Step 4: Write `src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireRole: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))

import { PATCH, DELETE } from './route'

beforeEach(() => vi.clearAllMocks())

describe('DELETE /api/ai/products/[id]/media/[fileId]', () => {
  it('deletes the row and GCs storage', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { storage_path: 'library/f-1.jpg' }, error: null }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }),
      }),
      storage: { from: () => ({ remove }) },
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const res = await DELETE(new Request('http://x'), {
      params: Promise.resolve({ id: 'p-1', fileId: 'f-1' }),
    })
    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(['library/f-1.jpg'])
  })
})

describe('PATCH /api/ai/products/[id]/media/[fileId]', () => {
  it('updates the label', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 'f-1' }, error: null }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ label: 'side view' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'p-1', fileId: 'f-1' }) })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/api/ai/products/[id]/media`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ai/products/\[id\]/media
git commit -m "Add POST /media and PATCH/DELETE /media/[fileId] product-file routes"
```

---

### Task 10: Rewrite the Settings library card (`ai-media-library.tsx`)

**Files:**
- Modify: `src/components/settings/ai-media-library.tsx` (full rewrite)

**Interfaces:**
- Consumes: `GET/POST /api/ai/products`, `GET/PATCH/DELETE /api/ai/products/[id]`, `POST /api/ai/products/[id]/media`, `PATCH/DELETE /api/ai/products/[id]/media/[fileId]` from Tasks 7–9. `uploadAccountMedia`, `deleteAccountMedia`, `MEDIA_MAX_BYTES_BY_KIND` from `@/lib/storage/upload-media` (unchanged).
- Produces: same exported symbol `AiMediaLibraryCard({ accountId, canEdit })` — the import in `ai-config.tsx:31,667` needs no change (Global Constraints: name kept on purpose).

- [ ] **Step 1: Replace the full file contents**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil, ImageIcon, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';

interface ProductFile {
  id: string;
  label: string | null;
  media_kind: 'image' | 'document';
  mime_type: string;
  storage_path: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  tag_label: string | null;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  price_notes: string | null;
  updated_at: string;
  files: ProductFile[];
}

/** Editor target: 'new' when creating, a product id when editing, null when closed. */
type EditTarget = 'new' | string | null;

export function AiMediaLibraryCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [name, setName] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [description, setDescription] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceNotes, setPriceNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [newFileLabel, setNewFileLabel] = useState('');
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/products');
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else toast.error(data.error ?? 'Failed to load product catalog.');
    } catch {
      toast.error('Failed to load product catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchItems();
  }, [accountId, fetchItems]);

  const resetForm = () => {
    setName('');
    setTagLabel('');
    setDescription('');
    setPriceMin('');
    setPriceMax('');
    setPriceUnit('');
    setPriceNotes('');
    setNewFileLabel('');
  };

  const openNew = () => {
    setEditing('new');
    resetForm();
  };

  const openEdit = (item: Product) => {
    setEditing(item.id);
    setName(item.name);
    setTagLabel(item.tag_label ?? '');
    setDescription(item.description);
    setPriceMin(item.price_min != null ? String(item.price_min) : '');
    setPriceMax(item.price_max != null ? String(item.price_max) : '');
    setPriceUnit(item.price_unit ?? '');
    setPriceNotes(item.price_notes ?? '');
    setNewFileLabel('');
  };

  const cancelEdit = () => {
    setEditing(null);
    resetForm();
  };

  const currentEditingItem = editing !== 'new' ? items.find((i) => i.id === editing) : null;

  const save = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error('Name and description are required.');
      return;
    }
    const parsedMin = priceMin.trim() ? Number(priceMin.trim()) : null;
    const parsedMax = priceMax.trim() ? Number(priceMax.trim()) : null;
    if (parsedMin !== null && parsedMax !== null && parsedMax < parsedMin) {
      toast.error('Max price must be greater than or equal to min price.');
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const payload = {
        name: name.trim(),
        description: description.trim(),
        tag_label: tagLabel.trim(),
        price_min: parsedMin,
        price_max: parsedMax,
        price_unit: priceUnit.trim() || null,
        price_notes: priceNotes.trim() || null,
      };
      const res = await fetch(isNew ? '/api/ai/products' : `/api/ai/products/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(isNew ? 'Product added.' : 'Product updated.');
        await fetchItems();
        if (isNew && data.id) {
          // Stay in the editor, now scoped to the new product, so
          // "Add file" becomes available immediately.
          setEditing(data.id);
        } else {
          cancelEdit();
        }
      } else {
        toast.error(data.error ?? 'Failed to save product.');
      }
    } catch {
      toast.error('Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Product removed.');
        setItems((d) => d.filter((x) => x.id !== id));
        if (editing === id) cancelEdit();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove product.');
      }
    } catch {
      toast.error('Failed to remove product.');
    }
  };

  const addFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || editing === 'new' || editing === null) return;
    const productId = editing;
    const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[mediaKind];
    if (file.size > maxBytes) {
      toast.error(
        mediaKind === 'image' ? 'Images must be 5 MB or smaller.' : 'Documents must be 16 MB or smaller.',
      );
      return;
    }
    setUploadingFile(true);
    try {
      const { path } = await uploadAccountMedia('ai-media', file);
      const res = await fetch(`/api/ai/products/${productId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newFileLabel.trim(),
          storage_path: path,
          mime_type: file.type,
          media_kind: mediaKind,
          file_size: file.size,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('File added.');
        setNewFileLabel('');
        await fetchItems();
      } else {
        toast.error(data.error ?? 'Failed to save file.');
        await deleteAccountMedia('ai-media', path).catch(() => {});
      }
    } catch {
      toast.error('Failed to upload file.');
    } finally {
      setUploadingFile(false);
    }
  };

  const removeFile = async (productId: string, fileId: string) => {
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${fileId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('File removed.');
        await fetchItems();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove file.');
      }
    } catch {
      toast.error('Failed to remove file.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="h-4 w-4 text-primary" /> Media library
        </CardTitle>
        <CardDescription>
          Products your AI agent can discuss and attach photos/catalogs for on its own,
          mid-conversation, when what the customer asks for clearly matches one -- no scripted
          flow needed. Each product's description is what the AI reads to decide relevance, so be
          specific. A product can have any number of files, or none yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : (
          <>
            {items.length === 0 && editing === null && (
              <p className="text-sm text-muted-foreground">
                No products yet. Add one below.
              </p>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {item.name}
                      <span className="text-muted-foreground">
                        {' '}
                        ({item.files.length} file{item.files.length === 1 ? '' : 's'})
                      </span>
                      {item.price_min != null && item.price_max != null && (
                        <span className="text-muted-foreground">
                          {' '}
                          ({item.price_min}-{item.price_max}
                          {item.price_unit ? ` / ${item.price_unit.replace(/_/g, ' ')}` : ''}
                          {item.price_notes ? ', + options' : ''})
                        </span>
                      )}
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(item)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => void remove(item.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="product-name">Name</Label>
                    <Input
                      id="product-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Rollup Shutter door"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-tag-label">Tag label (optional)</Label>
                    <Input
                      id="product-tag-label"
                      value={tagLabel}
                      onChange={(e) => setTagLabel(e.target.value)}
                      placeholder="Shutters"
                      disabled={saving}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Tag label names the CRM tag applied to a contact when this product is clearly
                  the topic of conversation. Leave blank to use the product name.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="product-price-min">Price min (optional)</Label>
                    <Input
                      id="product-price-min"
                      type="number"
                      step="any"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                      placeholder="80"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-price-max">Price max (optional)</Label>
                    <Input
                      id="product-price-max"
                      type="number"
                      step="any"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                      placeholder="120"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-price-unit">Unit</Label>
                    <Input
                      id="product-price-unit"
                      value={priceUnit}
                      onChange={(e) => setPriceUnit(e.target.value)}
                      placeholder="per_meter"
                      disabled={saving}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional — when both min and max are set, the AI may share this as a rough
                  estimate (always caveated as non-final); leave both blank to keep pricing
                  strictly human-confirmed.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="product-price-notes">Add-on / option pricing (optional)</Label>
                  <Textarea
                    id="product-price-notes"
                    value={priceNotes}
                    onChange={(e) => setPriceNotes(e.target.value)}
                    placeholder="Automatic +$60, manual included; custom colors +$20; motor add-on +$50-80"
                    rows={2}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only referenced by the AI alongside the price range above, never on its own.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-description">
                    Description (read by the AI to decide relevance)
                  </Label>
                  <Textarea
                    id="product-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Aluminum roller shutters for windows, cabins, and pool enclosures. Send when a customer asks about roller shutters, pricing, or a catalog."
                    rows={3}
                    disabled={saving}
                  />
                </div>

                {editing !== 'new' && (
                  <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                    <Label>Files</Label>
                    {(currentEditingItem?.files.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">No files yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {currentEditingItem?.files.map((f) => (
                          <li
                            key={f.id}
                            className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {f.media_kind === 'image' ? (
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="truncate">{f.label || '(no label)'}</span>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 shrink-0 p-0 text-destructive hover:text-destructive"
                              onClick={() => void removeFile(editing, f.id)}
                              title="Remove file"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-end gap-2 pt-1">
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="new-file-label" className="text-xs">
                          Label for next file (optional)
                        </Label>
                        <Input
                          id="new-file-label"
                          value={newFileLabel}
                          onChange={(e) => setNewFileLabel(e.target.value)}
                          placeholder="front view"
                          disabled={uploadingFile}
                        />
                      </div>
                      <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                        {uploadingFile ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Add file
                        <input
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                          onChange={(e) => void addFile(e)}
                          disabled={uploadingFile}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Images up to 5 MB, documents up to 16 MB.
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {editing === 'new' ? 'Cancel' : 'Done'}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <Button variant="outline" size="sm" onClick={openNew}>
                  <Plus className="me-2 h-4 w-4" /> Add product
                </Button>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, sign in as an admin, go to Settings → AI assistant.
Confirm: the "Media library" card lists the migrated "Rollup Shutter
door" product with its 1 file. Click Edit — confirm the file (no
label) is listed with a remove button, and "Add file" accepts a new
upload with a label. Click "Add product" — create one with just
name/description (no file), save, confirm it appears in the list with
"(0 files)" and that re-opening it now shows "Add file" available.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/ai-media-library.tsx
git commit -m "Rewrite Settings media library card for grouped products"
```

---

### Task 11: Rewrite the inbox catalog picker for a two-step product → file flow

**Files:**
- Modify: `src/components/inbox/catalog-picker-dialog.tsx` (full rewrite)
- Modify: `messages/en.json` (`Inbox.composer` — add 2 keys)
- Modify: `messages/ar.json` (`Inbox.composer` — add the same 2 keys, translated)

**Interfaces:**
- Consumes: `GET /api/ai/products` (Task 7) for step 1; nested `files` on each product for step 2 (no separate fetch needed — same response already carries both, unlike the settings card's per-product fetch, this dialog loads everything once).
- Produces: `onPick(item: CatalogPick)` — unchanged shape, unchanged callers (`message-composer.tsx` needs no changes).

- [ ] **Step 1: Add the two new translation keys**

In `messages/en.json`, inside `Inbox.composer` (find the existing
`"catalogEmpty": "..."` line and add these two keys right after it):

```json
    "catalogBack": "Back",
    "catalogNoFiles": "No files for this product yet.",
```

In `messages/ar.json`, inside `Inbox.composer` (same position, find
the existing `catalogEmpty` translation and add these two keys right
after it):

```json
    "catalogBack": "رجوع",
    "catalogNoFiles": "لا توجد ملفات لهذا المنتج بعد.",
```

- [ ] **Step 2: Verify locale parity**

Run:
```bash
node -e "
const en = require('./messages/en.json');
const ar = require('./messages/ar.json');
function flatten(obj, prefix='') {
  let keys = [];
  for (const k in obj) {
    const full = prefix ? prefix+'.'+k : k;
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) keys = keys.concat(flatten(obj[k], full));
    else keys.push(full);
  }
  return keys;
}
const enKeys = new Set(flatten(en));
const arKeys = new Set(flatten(ar));
console.log('missing:', [...enKeys].filter(k => !arKeys.has(k)));
console.log('extra:', [...arKeys].filter(k => !enKeys.has(k)));
"
```
Expected: `missing: []` and `extra: []`.

- [ ] **Step 3: Replace the full contents of `catalog-picker-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Loader2, ImageIcon, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { ComposerMediaKind } from "./message-composer";

interface CatalogFile {
  id: string;
  label: string | null;
  media_kind: "image" | "document";
  mime_type: string;
  storage_path: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  files: CatalogFile[];
}

export interface CatalogPick {
  kind: ComposerMediaKind;
  mediaUrl: string;
  path: string;
  filename: string;
}

interface CatalogPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: CatalogPick) => void;
}

/**
 * Lets a human agent attach a product-catalog file to a reply
 * immediately, instead of re-uploading a file every time. Two steps:
 * pick a product, then pick one of its files. Reuses the same
 * read-only `GET /api/ai/products` the AI's own attach flow reads
 * from (any account member may call it) -- one fetch loads every
 * product with its files nested, so step 2 needs no extra request.
 * Derives the public URL client-side -- the `ai-media` bucket is
 * public (migration 038), same as the auto-reply dispatcher's own
 * lookup.
 */
export function CatalogPickerDialog({
  open,
  onOpenChange,
  onPick,
}: CatalogPickerDialogProps) {
  const t = useTranslations("Inbox.composer");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!open) return;
    setSelectedProductId(null);
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/ai/products", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setProducts((data.items as CatalogProduct[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePickFile = (file: CatalogFile) => {
    const { data } = supabase.storage.from("ai-media").getPublicUrl(file.storage_path);
    const filename = file.storage_path.split("/").pop() || file.label || "file";
    onPick({
      kind: file.media_kind,
      mediaUrl: data.publicUrl,
      path: file.storage_path,
      filename,
    });
    onOpenChange(false);
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {selectedProduct && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSelectedProductId(null)}
                title={t("catalogBack")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>{selectedProduct ? selectedProduct.name : t("catalog")}</DialogTitle>
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedProduct ? (
            products.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("catalogEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {products.map((product) => {
                  const hasRange = product.price_min != null && product.price_max != null;
                  const unit = product.price_unit ? product.price_unit.replace(/_/g, " ") : "";
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedProductId(product.id)}
                        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {product.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {product.description}
                            {hasRange && (
                              <>
                                {" "}
                                ({product.price_min}-{product.price_max}
                                {unit ? ` / ${unit}` : ""})
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : selectedProduct.files.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("catalogNoFiles")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {selectedProduct.files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => handlePickFile(file)}
                    className="flex w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                  >
                    {file.media_kind === "image" ? (
                      <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm text-foreground">
                      {file.label || file.media_kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, open the inbox, open a conversation, click the
attach (📎) menu → Catalog. Confirm step 1 shows "Rollup Shutter
door", tapping it shows step 2 with its one file, the back chevron
returns to step 1, and tapping the file closes the dialog and attaches
it to the composer.

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/catalog-picker-dialog.tsx messages/en.json messages/ar.json
git commit -m "Rewrite inbox catalog picker as a two-step product/file flow"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npx eslint .`
Expected: 0 errors (pre-existing warnings unrelated to this feature are fine — do not fix unrelated files).

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every new file from Tasks 3, 5, 7, 8, 9.

- [ ] **Step 4: Production build**

Run: `npx next build`
Expected: exit code 0, no errors. Confirm `/api/ai/products`,
`/api/ai/products/[id]`, `/api/ai/products/[id]/media`, and
`/api/ai/products/[id]/media/[fileId]` all appear in the route list,
and `/api/ai/media` no longer does.

- [ ] **Step 5: Locale parity**

Re-run the parity check from Task 11 Step 2 — confirm still `missing:
[] extra: []` (nothing else should have drifted).

- [ ] **Step 6: Final commit (if any verification step required a fix)**

```bash
git add -A
git commit -m "Fix verification failures for AI product catalog"
```

(Skip this step entirely if Steps 1–5 all passed cleanly with no
changes needed.)

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — data model → Task 1; migration → Task 1; AI prompt/attach/tag logic → Tasks 3–5; playground → Task 6; Settings UI + routes → Tasks 7–10; inbox picker → Task 11; tests → folded into each task per TDD rather than a separate task, matching the spec's per-area test list.
- **Simplification found during planning:** the spec's Architecture section mentioned a `getProduct(db, accountId, productId)` lookup for tag resolution. Tracing the actual call site (`auto-reply.ts`'s `productTagId` handling) showed it already has the full products list in scope from `listProductsForPrompt` and does a plain `.find()` against it today (same pattern, just against files instead of products) — no extra DB round trip needed. Task 5 keeps that `.find()` pattern instead of adding a new function, which the spec left slightly ambiguous on this exact point.
- **Migration backfill simplified from the spec:** the spec's SQL joined the two backfill inserts back together by `name` + `created_at`, flagging that as fragile. Task 1 instead reuses each `ai_media_library` row's own `id` as the new `ai_products.id` directly (verified no other table has a FK to `ai_media_library.id`), which is both simpler and fully deterministic.
