# Product Catalog Media Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the AI product catalog's missing-thumbnail bug, add batch drag-and-drop upload, auto-generate an AI description per photo (reusing the existing vision pipeline), and move the catalog off the Agent settings page into its own settings section.

**Architecture:** One additive DB column (`ai_product_media.ai_description`) plus a small shared captioning helper reused by both the upload-registration route and a new regenerate route; the AI system prompt gains the description alongside each file's existing label. The settings UI is rebuilt as four small components (shared types, a media detail dialog, a photo grid with batch upload, a product info form) composed by one top-level panel wired into a new settings rail section, replacing the old card embedded in Agent settings.

**Tech Stack:** Next.js (App Router) API routes, Supabase (Postgres + Storage), React (client components), Vitest, existing `analyzeImage`/`loadImageAnalysisKey` vision pipeline, shadcn/ui components.

## Global Constraints

- Bucket `ai-media` is already public with a 16 MB limit; images are further capped client-side at 5 MB, documents at 16 MB (`MEDIA_MAX_BYTES_BY_KIND` in `src/lib/storage/upload-media.ts`) — do not change these.
- Captioning is always best-effort on upload: a vision failure must never block or fail the file-registration request (matches `src/lib/ai/vision.ts`'s existing contract). Only the explicit regenerate action surfaces a captioning failure to the user.
- No new background job/queue infrastructure — captioning runs inline in the per-file request; batch concurrency comes from the client firing multiple requests (capped at 3 concurrent), never server-side fan-out.
- Follow existing code conventions exactly: flat files under `src/components/settings/` (no new subfolder), the `requireRole`/`toErrorResponse` route-guard pattern, the `vi.hoisted` + `vi.mock` test-mocking style already used in this codebase's route tests.
- Run `npm run typecheck` after every frontend task; run `npm test -- <file>` (vitest) after every backend task. Both must pass before committing.

---

### Task 1: Migration — `ai_product_media.ai_description`

**Files:**
- Create: `supabase/migrations/063_ai_product_media_ai_description.sql`

**Interfaces:**
- Produces: column `ai_product_media.ai_description text` (nullable), consumed by Tasks 2, 3, 5, 6, 7, 8.

- [ ] **Step 1: Confirm the next free migration number**

Run: `ls supabase/migrations | sort | tail -5`
Expected: highest existing file is `062_fix_next_quotation_reference_auth.sql` — `063` is free. If a newer migration already exists, rename the file below to the actual next number instead.

- [ ] **Step 2: Write the migration**

```sql
-- ============================================================
-- 063_ai_product_media_ai_description.sql -- AI-generated photo
-- descriptions for product media (spec:
-- docs/superpowers/specs/2026-09-01-product-catalog-media-management-design.md)
--
-- Reuses the existing photo-analysis pipeline (migration 054,
-- src/lib/ai/vision.ts) that already captions inbound customer
-- photos, applied instead to uploaded product images so the AI can
-- tell multiple photos of the same product apart by more than a
-- manual label.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE ai_product_media
  ADD COLUMN IF NOT EXISTS ai_description text;
```

- [ ] **Step 3: Apply the migration**

Preferred: via the Supabase MCP tools --
1. `mcp__supabase__list_projects` to get the project id (name: "hightechhubTrading's Project").
2. `mcp__supabase__apply_migration` with that project id, `name: "ai_product_media_ai_description"`, and the SQL above.

Fallback if the Supabase MCP tools are unavailable: run `supabase db push` with the Supabase CLI against the project, or paste the SQL into the project's SQL Editor in the Supabase dashboard.

- [ ] **Step 4: Verify**

Run (via `mcp__supabase__execute_sql` on the same project, or the dashboard SQL Editor):
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_product_media' and column_name = 'ai_description';
```
Expected: one row, `data_type = 'text'`, `is_nullable = 'YES'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/063_ai_product_media_ai_description.sql
git commit -m "Add ai_description column to ai_product_media"
```

---

### Task 2: `ai_description` in the prompt-facing product listing

**Files:**
- Modify: `src/lib/ai/media-library.ts`
- Test: `src/lib/ai/media-library.test.ts`

**Interfaces:**
- Produces: `ProductMediaFilePromptItem.aiDescription: string | null`, and `listProductsForPrompt`'s returned `files[].aiDescription`. Consumed by Task 4 (`defaults.ts`) via the existing pass-through in `auto-reply.ts` / `playground/route.ts` (no changes needed there — see spec).

- [ ] **Step 1: Update the failing test**

In `src/lib/ai/media-library.test.ts`, change the `'maps a product with nested files to camelCase'` test's fixture and expectation:

```ts
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
            { id: 'f-1', label: 'front view', media_kind: 'image', ai_description: 'A black roller shutter, closed.' },
            { id: 'f-2', label: null, media_kind: 'document', ai_description: null },
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
          { id: 'f-1', label: 'front view', mediaKind: 'image', aiDescription: 'A black roller shutter, closed.' },
          { id: 'f-2', label: null, mediaKind: 'document', aiDescription: null },
        ],
      },
    ])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/media-library.test.ts`
Expected: FAIL — actual `files` entries are missing `aiDescription`.

- [ ] **Step 3: Implement**

In `src/lib/ai/media-library.ts`, update the interface and the select/map in `listProductsForPrompt`:

```ts
export interface ProductMediaFilePromptItem {
  id: string
  label: string | null
  mediaKind: 'image' | 'document'
  aiDescription: string | null
}
```

Change the select string:
```ts
      .select(
        'id, name, description, tag_id, price_min, price_max, price_unit, price_notes, ai_product_media(id, label, media_kind, ai_description)',
      )
```

Change the files map:
```ts
      files: (
        (row.ai_product_media as
          | { id: string; label: string | null; media_kind: 'image' | 'document'; ai_description: string | null }[]
          | null) ?? []
      ).map((f) => ({
        id: f.id,
        label: f.label,
        mediaKind: f.media_kind,
        aiDescription: f.ai_description,
      })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/ai/media-library.test.ts`
Expected: PASS (all tests in the file, including the two unchanged ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/media-library.ts src/lib/ai/media-library.test.ts
git commit -m "Include ai_description in the product-catalog prompt listing"
```

---

### Task 3: `captionProductMediaFile` helper

**Files:**
- Modify: `src/lib/ai/media-library.ts`
- Test: `src/lib/ai/media-library.test.ts`

**Interfaces:**
- Consumes: `loadImageAnalysisKey(db, accountId): Promise<{ provider: 'openai'|'gemini'|null, key: string|null, corrupt: boolean }>` from `./config`; `analyzeImage(args: { provider, apiKey, imageBuffer, mimeType, conversationContext? }): Promise<string>` from `./vision`.
- Produces: `captionProductMediaFile(db: SupabaseClient, accountId: string, file: { id: string; storagePath: string; mimeType: string; mediaKind: 'image' | 'document' }): Promise<string | null>` — best-effort, never throws. Consumed by Task 6 (POST media route) and Task 8 (regenerate route).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/ai/media-library.test.ts` (add `vi` to the vitest import, add two `vi.mock` calls above the existing imports, and a new `describe` block):

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listProductsForPrompt, getProductMediaItem, captionProductMediaFile } from './media-library'

const h = vi.hoisted(() => ({
  loadImageAnalysisKey: vi.fn(),
  analyzeImage: vi.fn(),
}))

vi.mock('./config', () => ({ loadImageAnalysisKey: h.loadImageAnalysisKey }))
vi.mock('./vision', () => ({ analyzeImage: h.analyzeImage }))
```

(Place these `vi.mock` calls right after the imports at the top of the file, before the existing `fakeListDb`/`fakeSingleDb` helpers.)

```ts
function fakeCaptionDb(opts: {
  downloadError?: unknown
  updateError?: unknown
}): SupabaseClient {
  const blob = new Blob([new Uint8Array([1, 2, 3])])
  const db = {
    storage: {
      from: () => ({
        download: () =>
          Promise.resolve(
            opts.downloadError ? { data: null, error: opts.downloadError } : { data: blob, error: null },
          ),
      }),
    },
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: opts.updateError ?? null }),
        }),
      }),
    }),
  }
  return db as unknown as SupabaseClient
}

describe('captionProductMediaFile', () => {
  it('returns null for a document (never sent to vision)', async () => {
    const db = fakeCaptionDb({})
    const result = await captionProductMediaFile(db, 'acc-1', {
      id: 'f-1',
      storagePath: 'account-acc-1/f-1.pdf',
      mimeType: 'application/pdf',
      mediaKind: 'document',
    })
    expect(result).toBeNull()
    expect(h.loadImageAnalysisKey).not.toHaveBeenCalled()
  })

  it('returns null when vision is not configured', async () => {
    h.loadImageAnalysisKey.mockResolvedValue({ provider: null, key: null, corrupt: false })
    const db = fakeCaptionDb({})
    const result = await captionProductMediaFile(db, 'acc-1', {
      id: 'f-1',
      storagePath: 'account-acc-1/f-1.jpg',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    })
    expect(result).toBeNull()
    expect(h.analyzeImage).not.toHaveBeenCalled()
  })

  it('captions and saves the description on success', async () => {
    h.loadImageAnalysisKey.mockResolvedValue({ provider: 'openai', key: 'sk-test', corrupt: false })
    h.analyzeImage.mockResolvedValue('A black roller shutter, closed.')
    const db = fakeCaptionDb({})
    const result = await captionProductMediaFile(db, 'acc-1', {
      id: 'f-1',
      storagePath: 'account-acc-1/f-1.jpg',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    })
    expect(result).toBe('A black roller shutter, closed.')
    expect(h.analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', apiKey: 'sk-test', mimeType: 'image/jpeg' }),
    )
  })

  it('returns null (never throws) when the download fails', async () => {
    h.loadImageAnalysisKey.mockResolvedValue({ provider: 'openai', key: 'sk-test', corrupt: false })
    const db = fakeCaptionDb({ downloadError: new Error('not found') })
    const result = await captionProductMediaFile(db, 'acc-1', {
      id: 'f-1',
      storagePath: 'account-acc-1/f-1.jpg',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    })
    expect(result).toBeNull()
  })

  it('returns null (never throws) when analyzeImage rejects', async () => {
    h.loadImageAnalysisKey.mockResolvedValue({ provider: 'openai', key: 'sk-test', corrupt: false })
    h.analyzeImage.mockRejectedValue(new Error('provider timeout'))
    const db = fakeCaptionDb({})
    const result = await captionProductMediaFile(db, 'acc-1', {
      id: 'f-1',
      storagePath: 'account-acc-1/f-1.jpg',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/ai/media-library.test.ts`
Expected: FAIL — `captionProductMediaFile` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/ai/media-library.ts` (below the existing `getProductMediaItem`), with new imports at the top:

```ts
import { loadImageAnalysisKey } from './config'
import { analyzeImage } from './vision'
```

```ts
/**
 * Best-effort: generates an AI description for one product image and
 * saves it to `ai_product_media.ai_description`. Returns the
 * description on success, or null when nothing was generated --
 * not an image, vision not configured for the account, or a
 * download/provider/network failure. Never throws -- callers (file
 * registration, the regenerate endpoint) decide what null means for
 * their own response.
 */
export async function captionProductMediaFile(
  db: SupabaseClient,
  accountId: string,
  file: { id: string; storagePath: string; mimeType: string; mediaKind: 'image' | 'document' },
): Promise<string | null> {
  if (file.mediaKind !== 'image') return null
  try {
    const { provider, key } = await loadImageAnalysisKey(db, accountId)
    if (!provider || !key) return null

    const { data: blob, error: downloadError } = await db.storage
      .from('ai-media')
      .download(file.storagePath)
    if (downloadError || !blob) return null

    const imageBuffer = Buffer.from(await blob.arrayBuffer())
    const description = await analyzeImage({
      provider,
      apiKey: key,
      imageBuffer,
      mimeType: file.mimeType,
    })

    const { error: updateError } = await db
      .from('ai_product_media')
      .update({ ai_description: description })
      .eq('account_id', accountId)
      .eq('id', file.id)
    if (updateError) {
      console.error('[ai product catalog] captionProductMediaFile update failed:', updateError)
      return null
    }
    return description
  } catch (err) {
    console.error('[ai product catalog] captionProductMediaFile failed:', err)
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ai/media-library.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/media-library.ts src/lib/ai/media-library.test.ts
git commit -m "Add captionProductMediaFile helper"
```

---

### Task 4: Feed the description into the system prompt

**Files:**
- Modify: `src/lib/ai/defaults.ts`
- Test: `src/lib/ai/defaults.test.ts`

**Interfaces:**
- Consumes: `MediaPromptItem.files[].aiDescription` (new field, must match `ProductMediaFilePromptItem` from Task 2 exactly since `auto-reply.ts`/`playground/route.ts` pass `listProductsForPrompt`'s result straight into `buildSystemPrompt` with no remapping).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ai/defaults.test.ts`:

```ts
import { buildSystemPrompt } from './defaults'

describe('buildSystemPrompt — product catalog file lines', () => {
  it('appends the AI description after the label/kind when present', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      media: [
        {
          id: 'p-1',
          name: 'Rollup Shutter door',
          description: 'Aluminum rollup shutters',
          files: [
            {
              id: 'f-1',
              label: 'front view',
              mediaKind: 'image',
              aiDescription: 'A black roller shutter, closed, motor visible at top.',
            },
          ],
        },
      ],
    })
    expect(prompt).toContain(
      '  - [f-1] front view (image): A black roller shutter, closed, motor visible at top.',
    )
  })

  it('omits the trailing colon when there is no description', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      media: [
        {
          id: 'p-1',
          name: 'Rollup Shutter door',
          description: 'Aluminum rollup shutters',
          files: [{ id: 'f-1', label: null, mediaKind: 'document', aiDescription: null }],
        },
      ],
    })
    expect(prompt).toContain('  - [f-1] (document)')
    expect(prompt).not.toContain('(document):')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/defaults.test.ts`
Expected: FAIL — either a TypeScript error (`aiDescription` not assignable, since `MediaPromptFileItem` doesn't have it yet) or the output string doesn't contain the description.

- [ ] **Step 3: Implement**

In `src/lib/ai/defaults.ts`, update the interface:

```ts
export interface MediaPromptFileItem {
  id: string
  label: string | null
  mediaKind: 'image' | 'document'
  aiDescription: string | null
}
```

And the file-line formatting (inside `buildSystemPrompt`'s media section):

```ts
            const fileLines = m.files
              .map(
                (f) =>
                  `  - [${f.id}] ${f.label ? f.label + ' ' : ''}(${f.mediaKind})${f.aiDescription ? ': ' + f.aiDescription : ''}`,
              )
              .join('\n')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/ai/defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/defaults.ts src/lib/ai/defaults.test.ts
git commit -m "Feed each product photo's AI description into the system prompt"
```

---

### Task 5: `GET /api/ai/products` returns `ai_description`

**Files:**
- Modify: `src/app/api/ai/products/route.ts`
- Test: `src/app/api/ai/products/route.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/api/ai/products/route.test.ts`, inside the `describe('GET /api/ai/products', ...)` block:

```ts
  it('requests ai_description in the select clause', async () => {
    const selectSpy = vi.fn().mockReturnValue({
      eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    })
    h.getCurrentAccount.mockResolvedValue({
      supabase: { from: () => ({ select: selectSpy }) },
      accountId: 'acc-1',
    })
    await GET()
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('ai_description'))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/ai/products/route.test.ts`
Expected: FAIL — select clause doesn't mention `ai_description` yet.

- [ ] **Step 3: Implement**

In `src/app/api/ai/products/route.ts`'s `GET`, change the select string:

```ts
      .select(
        'id, name, description, tag_label, price_min, price_max, price_unit, price_notes, updated_at, ai_product_media(id, label, media_kind, mime_type, storage_path, ai_description)',
      )
```

(No other change needed — `files: row.ai_product_media ?? []` already passes every column through as-is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/ai/products/route.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/products/route.ts src/app/api/ai/products/route.test.ts
git commit -m "Return ai_description from GET /api/ai/products"
```

---

### Task 6: Caption a photo on upload

**Files:**
- Modify: `src/app/api/ai/products/[id]/media/route.ts`
- Test: `src/app/api/ai/products/[id]/media/route.test.ts`

**Interfaces:**
- Consumes: `captionProductMediaFile` from Task 3.

- [ ] **Step 1: Update the failing test**

In `src/app/api/ai/products/[id]/media/route.test.ts`, add the mock and update the existing "adds a file" test, plus one new test:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  captionProductMediaFile: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ai/media-library', () => ({
  captionProductMediaFile: h.captionProductMediaFile,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})
```

Update the second test (`'adds a file to an existing product'`) to set an explicit caption result and assert it's returned:

```ts
  it('adds a file to an existing product and returns its AI description', async () => {
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
    h.captionProductMediaFile.mockResolvedValue('A black roller shutter, closed.')
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ label: 'front view', storage_path: 'p', mime_type: 'image/jpeg', media_kind: 'image' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'p-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, id: 'f-new', ai_description: 'A black roller shutter, closed.' })
    expect(h.captionProductMediaFile).toHaveBeenCalledWith(
      supabase,
      'acc-1',
      { id: 'f-new', storagePath: 'p', mimeType: 'image/jpeg', mediaKind: 'image' },
    )
  })

  it('still succeeds with ai_description: null when captioning is not configured', async () => {
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
    h.captionProductMediaFile.mockResolvedValue(null)
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ label: '', storage_path: 'p', mime_type: 'application/pdf', media_kind: 'document' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'p-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, id: 'f-new', ai_description: null })
  })
```

Leave the `'404s when the product does not exist'` test as-is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/app/api/ai/products/[id]/media/route.test.ts`
Expected: FAIL — response body doesn't include `ai_description`, `captionProductMediaFile` never called.

- [ ] **Step 3: Implement**

In `src/app/api/ai/products/[id]/media/route.ts`, add the import and call it after the insert, before returning:

```ts
import { captionProductMediaFile } from '@/lib/ai/media-library'
```

```ts
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

    const aiDescription = await captionProductMediaFile(supabase, accountId, {
      id: item.id,
      storagePath,
      mimeType,
      mediaKind,
    })

    return NextResponse.json({ success: true, id: item.id, ai_description: aiDescription })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/app/api/ai/products/[id]/media/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/products/[id]/media/route.ts src/app/api/ai/products/[id]/media/route.test.ts
git commit -m "Caption product photos on upload"
```

---

### Task 7: `PATCH .../media/[fileId]` accepts `ai_description`

**Files:**
- Modify: `src/app/api/ai/products/[id]/media/[fileId]/route.ts`
- Test: `src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('PATCH ...')` block in `src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`:

```ts
  it('updates label and ai_description together', async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: 'f-1' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const supabase = { from: () => ({ update: updateSpy }) }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1' })
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'side view', ai_description: 'A black roller shutter, closed.' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'p-1', fileId: 'f-1' }) })
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({
      label: 'side view',
      ai_description: 'A black roller shutter, closed.',
    })
  })

  it('rejects a non-string, non-null ai_description', async () => {
    h.requireRole.mockResolvedValue({ supabase: {}, accountId: 'acc-1' })
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'x', ai_description: 42 }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'p-1', fileId: 'f-1' }) })
    expect(res.status).toBe(400)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`
Expected: FAIL — `updateSpy` called with `{ label: 'side view' }` only (no `ai_description` key), and the invalid-type test gets a 200 or 500 instead of 400.

- [ ] **Step 3: Implement**

In `src/app/api/ai/products/[id]/media/[fileId]/route.ts`'s `PATCH`:

```ts
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id, fileId } = await params
    const body = await request.json().catch(() => null)
    if (typeof body?.label !== 'string' && body?.label !== null) {
      return NextResponse.json({ error: "'label' must be a string or null" }, { status: 400 })
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null

    const updatePayload: { label: string | null; ai_description?: string | null } = { label }
    if (Object.prototype.hasOwnProperty.call(body, 'ai_description')) {
      if (typeof body.ai_description !== 'string' && body.ai_description !== null) {
        return NextResponse.json(
          { error: "'ai_description' must be a string or null" },
          { status: 400 },
        )
      }
      updatePayload.ai_description =
        typeof body.ai_description === 'string' && body.ai_description.trim()
          ? body.ai_description.trim()
          : null
    }

    const { data: updated, error } = await supabase
      .from('ai_product_media')
      .update(updatePayload)
      .eq('account_id', accountId)
      .eq('id', fileId)
      .eq('product_id', id)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`
Expected: PASS (all tests, including the pre-existing `'updates the label'` one — it doesn't send `ai_description`, so `updatePayload` stays `{ label: 'side view' }`, unaffected by the new optional key).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/products/[id]/media/[fileId]/route.ts src/app/api/ai/products/[id]/media/[fileId]/route.test.ts
git commit -m "Let PATCH .../media/[fileId] update ai_description"
```

---

### Task 8: Regenerate endpoint

**Files:**
- Create: `src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.ts`
- Test: `src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.test.ts`

**Interfaces:**
- Consumes: `captionProductMediaFile` from Task 3.
- Produces: `POST /api/ai/products/[id]/media/[fileId]/regenerate` — 200 `{ success: true, ai_description: string }`, 404 if not found, 400 if not an image, 422 if captioning didn't produce a description. Consumed by Task 9's `ProductMediaDialog`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  captionProductMediaFile: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ai/media-library', () => ({
  captionProductMediaFile: h.captionProductMediaFile,
}))

import { POST } from './route'

function paramsFor(id: string, fileId: string) {
  return { params: Promise.resolve({ id, fileId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('POST /api/ai/products/[id]/media/[fileId]/regenerate', () => {
  it('404s when the file does not exist in this account/product', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'missing'))
    expect(res.status).toBe(404)
  })

  it('400s for a document (nothing to caption)', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'f-1', storage_path: 'p.pdf', mime_type: 'application/pdf', media_kind: 'document' },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    expect(res.status).toBe(400)
  })

  it('422s when captioning fails to produce a description', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'f-1', storage_path: 'p.jpg', mime_type: 'image/jpeg', media_kind: 'image' },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    h.captionProductMediaFile.mockResolvedValue(null)
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    expect(res.status).toBe(422)
  })

  it('200s with the new description on success', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'f-1', storage_path: 'p.jpg', mime_type: 'image/jpeg', media_kind: 'image' },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    h.requireRole.mockResolvedValue({ supabase, accountId: 'acc-1', userId: 'u-1' })
    h.captionProductMediaFile.mockResolvedValue('A black roller shutter, closed.')
    const res = await POST(new Request('http://x', { method: 'POST' }), paramsFor('p-1', 'f-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, ai_description: 'A black roller shutter, closed.' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.test.ts`
Expected: FAIL — the route file doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { captionProductMediaFile } from '@/lib/ai/media-library'

type Params = { params: Promise<{ id: string; fileId: string }> }

/**
 * POST /api/ai/products/[id]/media/[fileId]/regenerate (admin+)
 *
 * Re-runs AI captioning for one existing product image -- used to
 * backfill photos uploaded before vision was configured, or to retry
 * after a bad/failed caption. Unlike the upload-time captioning in
 * POST .../media (best-effort, silent on failure), this is an
 * explicit user action, so a failure is reported rather than
 * swallowed.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-products-media-regenerate:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id: productId, fileId } = await params
    const { data: file, error } = await supabase
      .from('ai_product_media')
      .select('id, storage_path, mime_type, media_kind')
      .eq('account_id', accountId)
      .eq('id', fileId)
      .eq('product_id', productId)
      .maybeSingle()
    if (error || !file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (file.media_kind !== 'image') {
      return NextResponse.json({ error: 'Only images can be captioned' }, { status: 400 })
    }

    const description = await captionProductMediaFile(supabase, accountId, {
      id: file.id,
      storagePath: file.storage_path,
      mimeType: file.mime_type,
      mediaKind: file.media_kind,
    })
    if (description === null) {
      return NextResponse.json(
        {
          error:
            'Could not generate a description. Check that photo analysis is enabled and configured in Agent settings.',
        },
        { status: 422 },
      )
    }
    return NextResponse.json({ success: true, ai_description: description })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.ts src/app/api/ai/products/[id]/media/[fileId]/regenerate/route.test.ts
git commit -m "Add product-photo caption regenerate endpoint"
```

---

### Task 9: Shared types + media detail dialog

**Files:**
- Create: `src/components/settings/product-catalog-types.ts`
- Create: `src/components/settings/product-media-dialog.tsx`

**Interfaces:**
- Produces: `ProductFile`, `Product`, `productMediaPublicUrl(storagePath: string): string` — consumed by Tasks 10, 11, 12. `ProductMediaDialog` component — consumed by Task 10.

- [ ] **Step 1: Create the shared types module**

Create `src/components/settings/product-catalog-types.ts`:

```ts
import { createClient } from '@/lib/supabase/client';

export interface ProductFile {
  id: string;
  label: string | null;
  ai_description: string | null;
  media_kind: 'image' | 'document';
  mime_type: string;
  storage_path: string;
}

export interface Product {
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

/** Public URL for a file in the `ai-media` bucket (already public --
 * this is a pure client-side string construction, no network call). */
export function productMediaPublicUrl(storagePath: string): string {
  return createClient().storage.from('ai-media').getPublicUrl(storagePath).data.publicUrl;
}
```

- [ ] **Step 2: Create the media detail dialog**

Create `src/components/settings/product-media-dialog.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { productMediaPublicUrl, type ProductFile } from './product-catalog-types';

export function ProductMediaDialog({
  file,
  productId,
  canEdit,
  onClose,
  onChanged,
}: {
  file: ProductFile;
  productId: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState(file.label ?? '');
  const [description, setDescription] = useState(file.ai_description ?? '');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLabel(file.label ?? '');
    setDescription(file.ai_description ?? '');
  }, [file.id]);

  const publicUrl = productMediaPublicUrl(file.storage_path);
  const busy = saving || regenerating || deleting;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), ai_description: description.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('File updated.');
        onChanged();
      } else {
        toast.error(data.error ?? 'Failed to update file.');
      }
    } catch {
      toast.error('Failed to update file.');
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${file.id}/regenerate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setDescription(data.ai_description ?? '');
        toast.success('Description regenerated.');
        onChanged();
      } else {
        toast.error(data.error ?? 'Could not regenerate description.');
      }
    } catch {
      toast.error('Could not regenerate description.');
    } finally {
      setRegenerating(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${file.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('File removed.');
        onChanged();
        onClose();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove file.');
      }
    } catch {
      toast.error('Failed to remove file.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{file.label || 'Untitled file'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {file.media_kind === 'image' ? (
            <img
              src={publicUrl}
              alt={file.label ?? ''}
              className="max-h-72 w-full rounded-md border border-border bg-muted/30 object-contain"
            />
          ) : (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-foreground hover:bg-accent"
            >
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              Open file in a new tab
            </a>
          )}

          <div className="space-y-2">
            <Label htmlFor="media-label">Label</Label>
            <Input
              id="media-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="front view"
              disabled={!canEdit || busy}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="media-description">AI description</Label>
              {file.media_kind === 'image' && canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void regenerate()}
                  disabled={busy}
                >
                  {regenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Regenerate
                </Button>
              )}
            </div>
            <Textarea
              id="media-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the AI agent reads to tell this file apart from the product's others."
              rows={3}
              disabled={!canEdit || busy}
            />
          </div>
        </div>

        {canEdit && (
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => void remove()}
              disabled={busy}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/product-catalog-types.ts src/components/settings/product-media-dialog.tsx
git commit -m "Add product catalog shared types and media detail dialog"
```

---

### Task 10: Photo/file grid with batch upload

**Files:**
- Create: `src/components/settings/product-media-grid.tsx`

**Interfaces:**
- Consumes: `ProductFile`, `productMediaPublicUrl` from `./product-catalog-types` (Task 9); `ProductMediaDialog` from `./product-media-dialog` (Task 9); `uploadAccountMedia`, `deleteAccountMedia`, `MEDIA_MAX_BYTES_BY_KIND` from `@/lib/storage/upload-media` (existing).
- Produces: `ProductMediaGrid` component — consumed by Task 12.

- [ ] **Step 1: Create the component**

Create `src/components/settings/product-media-grid.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ProductMediaDialog } from './product-media-dialog';
import { productMediaPublicUrl, type ProductFile } from './product-catalog-types';

const MAX_CONCURRENT_UPLOADS = 3;

interface PendingFile {
  localId: string;
  name: string;
  status: 'uploading' | 'describing' | 'error';
}

export function ProductMediaGrid({
  productId,
  files,
  canEdit,
  onChanged,
}: {
  productId: string;
  files: ProductFile[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setStatus = (localId: string, status: PendingFile['status']) => {
    setPending((p) => p.map((f) => (f.localId === localId ? { ...f, status } : f)));
  };

  const uploadOne = async (localId: string, file: File) => {
    const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
    try {
      const { path } = await uploadAccountMedia('ai-media', file);
      setStatus(localId, 'describing');
      const res = await fetch(`/api/ai/products/${productId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: '',
          storage_path: path,
          mime_type: file.type,
          media_kind: mediaKind,
          file_size: file.size,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Failed to save ${file.name}.`);
        await deleteAccountMedia('ai-media', path).catch(() => {});
        setStatus(localId, 'error');
        return;
      }
      setPending((p) => p.filter((f) => f.localId !== localId));
    } catch {
      toast.error(`Failed to upload ${file.name}.`);
      setStatus(localId, 'error');
    }
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    if (!canEdit) return;
    const incoming = Array.from(fileList);
    const queue: { localId: string; file: File }[] = [];
    const nextPending: PendingFile[] = [];

    for (const file of incoming) {
      const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
      const maxBytes = MEDIA_MAX_BYTES_BY_KIND[mediaKind];
      if (file.size > maxBytes) {
        toast.error(
          `${file.name}: ${mediaKind === 'image' ? 'images must be 5 MB or smaller.' : 'documents must be 16 MB or smaller.'}`,
        );
        continue;
      }
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      queue.push({ localId, file });
      nextPending.push({ localId, name: file.name, status: 'uploading' });
    }
    if (queue.length === 0) return;

    setPending((p) => [...p, ...nextPending]);

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor];
        cursor += 1;
        await uploadOne(item.localId, item.file);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, queue.length) }, worker),
    );
    onChanged();
  };

  const openFile = files.find((f) => f.id === openFileId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Photos & files</span>
        {canEdit && (
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent">
            <Upload className="h-3.5 w-3.5" />
            Select files
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>

      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!canEdit || !e.dataTransfer.files?.length) return;
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'grid grid-cols-2 gap-3 rounded-md border border-dashed p-3 sm:grid-cols-3 md:grid-cols-4',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        {files.length === 0 && pending.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
            {canEdit ? 'Drop images here, or use "Select files".' : 'No files yet.'}
          </p>
        )}

        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setOpenFileId(f.id)}
            className="group flex flex-col overflow-hidden rounded-md border border-border text-start hover:border-primary/50"
          >
            <span className="flex aspect-square items-center justify-center bg-muted/30">
              {f.media_kind === 'image' ? (
                <img
                  src={productMediaPublicUrl(f.storage_path)}
                  alt={f.label ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <FileText className="h-8 w-8 text-muted-foreground" />
              )}
            </span>
            <span className="truncate px-2 py-1.5 text-xs text-foreground">
              {f.label || (f.ai_description ? f.ai_description.slice(0, 40) : '(untitled)')}
            </span>
          </button>
        ))}

        {pending.map((p) => (
          <div
            key={p.localId}
            className="flex flex-col overflow-hidden rounded-md border border-dashed border-border"
          >
            <span className="flex aspect-square flex-col items-center justify-center gap-1.5 bg-muted/30 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-[10px]">
                {p.status === 'uploading'
                  ? 'Uploading…'
                  : p.status === 'describing'
                    ? 'Describing…'
                    : 'Failed'}
              </span>
            </span>
            <span className="truncate px-2 py-1.5 text-xs text-muted-foreground">{p.name}</span>
          </div>
        ))}
      </div>

      {openFile && (
        <ProductMediaDialog
          file={openFile}
          productId={productId}
          canEdit={canEdit}
          onClose={() => setOpenFileId(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/product-media-grid.tsx
git commit -m "Add product media grid with batch drag-and-drop upload"
```

---

### Task 11: Product info form

**Files:**
- Create: `src/components/settings/product-catalog-form.tsx`

**Interfaces:**
- Consumes: `Product` from `./product-catalog-types` (Task 9).
- Produces: `ProductCatalogForm` component — consumed by Task 12.

- [ ] **Step 1: Create the component**

Create `src/components/settings/product-catalog-form.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Product } from './product-catalog-types';

export function ProductCatalogForm({
  product,
  canEdit,
  onSaved,
  onCancel,
}: {
  /** null when creating a new product. */
  product: Product | null;
  canEdit: boolean;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [description, setDescription] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceNotes, setPriceNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(product?.name ?? '');
    setTagLabel(product?.tag_label ?? '');
    setDescription(product?.description ?? '');
    setPriceMin(product?.price_min != null ? String(product.price_min) : '');
    setPriceMax(product?.price_max != null ? String(product.price_max) : '');
    setPriceUnit(product?.price_unit ?? '');
    setPriceNotes(product?.price_notes ?? '');
  }, [product]);

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
      const isNew = product === null;
      const payload = {
        name: name.trim(),
        description: description.trim(),
        tag_label: tagLabel.trim(),
        price_min: parsedMin,
        price_max: parsedMax,
        price_unit: priceUnit.trim() || null,
        price_notes: priceNotes.trim() || null,
      };
      const res = await fetch(isNew ? '/api/ai/products' : `/api/ai/products/${product.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(isNew ? 'Product added.' : 'Product updated.');
        onSaved(isNew ? data.id : product.id);
      } else {
        toast.error(data.error ?? 'Failed to save product.');
      }
    } catch {
      toast.error('Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rollup Shutter door"
            disabled={!canEdit || saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-tag-label">Tag label (optional)</Label>
          <Input
            id="product-tag-label"
            value={tagLabel}
            onChange={(e) => setTagLabel(e.target.value)}
            placeholder="Shutters"
            disabled={!canEdit || saving}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Tag label names the CRM tag applied to a contact when this product is clearly the topic
        of conversation. Leave blank to use the product name.
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
            disabled={!canEdit || saving}
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
            disabled={!canEdit || saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-price-unit">Unit</Label>
          <Input
            id="product-price-unit"
            value={priceUnit}
            onChange={(e) => setPriceUnit(e.target.value)}
            placeholder="per_meter"
            disabled={!canEdit || saving}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional — when both min and max are set, the AI may share this as a rough estimate
        (always caveated as non-final); leave both blank to keep pricing strictly
        human-confirmed.
      </p>
      <div className="space-y-2">
        <Label htmlFor="product-price-notes">Add-on / option pricing (optional)</Label>
        <Textarea
          id="product-price-notes"
          value={priceNotes}
          onChange={(e) => setPriceNotes(e.target.value)}
          placeholder="Automatic +$60, manual included; custom colors +$20; motor add-on +$50-80"
          rows={2}
          disabled={!canEdit || saving}
        />
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
          disabled={!canEdit || saving}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {product === null ? 'Cancel' : 'Close'}
        </Button>
        {canEdit && (
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/product-catalog-form.tsx
git commit -m "Add product catalog info form"
```

---

### Task 12: Top-level panel

**Files:**
- Create: `src/components/settings/product-catalog-panel.tsx`

**Interfaces:**
- Consumes: `Product` from `./product-catalog-types`; `ProductCatalogForm` from `./product-catalog-form` (Task 11); `ProductMediaGrid` from `./product-media-grid` (Task 10).
- Produces: `ProductCatalogPanel` component — consumed by Task 13.

- [ ] **Step 1: Create the component**

Create `src/components/settings/product-catalog-panel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ProductCatalogForm } from './product-catalog-form';
import { ProductMediaGrid } from './product-media-grid';
import type { Product } from './product-catalog-types';

/** Selected product: an existing product's id, 'new' when creating, or
 * null when nothing is selected yet. */
type Selection = string | 'new' | null;

export function ProductCatalogPanel() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
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

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Product removed.');
        setItems((d) => d.filter((x) => x.id !== id));
        if (selection === id) setSelection(null);
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove product.');
      }
    } catch {
      toast.error('Failed to remove product.');
    }
  };

  const selected =
    selection !== 'new' && selection !== null
      ? (items.find((i) => i.id === selection) ?? null)
      : null;

  if (profileLoading || loading) {
    return (
      <Card>
        <CardContent className="flex items-center py-8 text-sm text-muted-foreground">
          <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
          <CardDescription>
            Products your AI agent can discuss and attach photos/catalogs for on its own,
            mid-conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No products yet.</p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelection(item.id)}
                    className={cn(
                      'min-w-0 flex-1 truncate text-start text-sm hover:underline',
                      selection === item.id ? 'font-medium text-primary' : 'text-foreground',
                    )}
                  >
                    {item.name}
                    <span className="text-muted-foreground">
                      {' '}
                      ({item.files.length} file{item.files.length === 1 ? '' : 's'})
                    </span>
                  </button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
                      onClick={() => void remove(item.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setSelection('new')}>
              <Plus className="me-2 h-4 w-4" /> Add product
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selection === 'new' ? 'New product' : (selected?.name ?? 'Product details')}
          </CardTitle>
          <CardDescription>
            Each product&apos;s description is what the AI reads to decide relevance, so be
            specific. A product can have any number of photos or files, or none yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selection === null ? (
            <p className="text-sm text-muted-foreground">
              Select a product on the left, or add a new one.
            </p>
          ) : (
            <div className="space-y-4">
              <ProductCatalogForm
                product={selection === 'new' ? null : selected}
                canEdit={canEdit}
                onSaved={(id) => {
                  void fetchItems();
                  setSelection(id);
                }}
                onCancel={() => setSelection(null)}
              />
              {selected && (
                <ProductMediaGrid
                  productId={selected.id}
                  files={selected.files}
                  canEdit={canEdit}
                  onChanged={fetchItems}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/product-catalog-panel.tsx
git commit -m "Add top-level product catalog panel"
```

---

### Task 13: Rail wiring + remove the old embedded card

**Files:**
- Modify: `src/components/settings/settings-sections.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/components/settings/ai-config.tsx`
- Delete: `src/components/settings/ai-media-library.tsx`

**Interfaces:**
- Consumes: `ProductCatalogPanel` from Task 12.

- [ ] **Step 1: Add the rail section**

In `src/components/settings/settings-sections.ts`:

Add `Package` to the lucide-react import at the top:
```ts
import {
  Coins,
  FileText,
  Hash,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  Package,
  Palette,
  PlugZap,
  Shield,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
```

Add `'products'` to `SETTINGS_SECTIONS` (after `'deals'`, matching the workspace grouping order):
```ts
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'templates',
  'quick-replies',
  'fields',
  'deals',
  'products',
  'group-notifications',
  'members',
  'api',
  'quotation-product-codes',
] as const;
```

Add its metadata to `SECTION_META` (after `deals`):
```ts
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace' },
  products: { id: 'products', label: 'Product catalog', icon: Package, group: 'workspace' },
```

- [ ] **Step 2: Wire the panel into the settings page**

In `src/app/(dashboard)/settings/page.tsx`, add the import:
```ts
import { ProductCatalogPanel } from '@/components/settings/product-catalog-panel';
```

Add it to the `panel` map (after `deals`):
```ts
    deals: <DealsSettings />,
    products: <ProductCatalogPanel />,
```

- [ ] **Step 3: Remove the old embedded card from Agent settings**

In `src/components/settings/ai-config.tsx`:

Replace the lucide-react import (add `ImageIcon`):
```ts
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff, AlertTriangle, ImageIcon } from 'lucide-react';
```

Add a router import:
```ts
import { useRouter } from 'next/navigation';
```

Replace:
```ts
import { AiMediaLibraryCard } from './ai-media-library';
```
with nothing (delete that line entirely).

Inside the component, add the router hook next to the existing `useAuth()` call:
```ts
  const router = useRouter();
  const { accountId, accountRole, profileLoading } = useAuth();
```

Replace the old embed:
```tsx
        <AiMediaLibraryCard accountId={accountId} canEdit={canEdit} />
```
with a pointer card:
```tsx
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-4 w-4 text-primary" /> Product catalog
            </CardTitle>
            <CardDescription>
              Product photos and catalog files have moved to their own settings page, with a
              proper photo grid, batch upload, and AI-generated descriptions per photo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push('/settings?tab=products')}
            >
              Open product catalog
            </Button>
          </CardContent>
        </Card>
```

- [ ] **Step 4: Delete the old component**

```bash
rm "src/components/settings/ai-media-library.tsx"
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms nothing else imports the deleted file, and all new wiring type-checks).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/settings-sections.ts src/app/\(dashboard\)/settings/page.tsx src/components/settings/ai-config.tsx
git add -u src/components/settings/ai-media-library.tsx
git commit -m "Move product catalog to its own settings section"
```

---

### Task 14: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`
Expected: all tests pass, including every new/modified file from Tasks 2–8.

- [ ] **Step 2: Run the full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Start the app and exercise the feature**

Use the `run` skill (or `npm run dev`) to start the app, sign in as an admin, and go to Settings → Product catalog (`/settings?tab=products`). Walk through:

1. **Old card is gone**: Settings → AI Agent no longer shows the media library card, just a "Product catalog" pointer card whose button navigates to the new section.
2. **Create a product**: "Add product" → fill name + description → Save. Confirm it appears in the left list and the photo grid appears once saved.
3. **Batch upload**: drag 3+ image files onto the grid at once (or use "Select files" with a multi-select). Confirm each shows "Uploading…" then "Describing…" (if photo analysis is configured for this account under Settings → AI Agent → photo analysis; otherwise it should just finish without a description — verify that path too by leaving it unconfigured) then a real thumbnail — **this is the bug-fix verification**: confirm every uploaded image renders as an actual thumbnail, not a generic icon.
4. **Open a file**: click a thumbnail → dialog shows the full image, editable label, editable AI description (populated if vision is configured), a Regenerate button, and Delete.
5. **Regenerate**: with vision configured, click Regenerate on an image → description updates and a success toast appears.
6. **Edit + save**: change the label, Save → dialog closes/stays with a success toast, thumbnail's caption updates.
7. **Delete a file**: confirm it's removed from the grid and (via Supabase dashboard → Storage → `ai-media`, spot-check) the underlying object is gone.
8. **Delete a product**: confirm it disappears from the left list.
9. **Non-image upload**: drop a PDF → shows a document-style thumbnail (no vision call attempted), opens with the "Open file in a new tab" link in the dialog instead of an `<img>`.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any step fails, fix the relevant earlier task, re-run its tests, and re-verify here before considering the plan complete.

---

## Self-Review Notes

- **Spec coverage**: thumbnails/preview (Tasks 9–10, verified in 14.3/14.9), batch drag-and-drop (Task 10), AI auto-caption on upload (Tasks 3, 6), editable + regenerate description (Tasks 7–9), dedicated settings section (Task 13) — every spec goal has a task.
- **Type consistency checked**: `ProductMediaFilePromptItem.aiDescription` (Task 2) and `MediaPromptFileItem.aiDescription` (Task 4) are the same shape so the existing untouched pass-through in `auto-reply.ts`/`playground/route.ts` keeps compiling. `captionProductMediaFile`'s signature (Task 3) is used identically in Tasks 6 and 8. `ProductFile`/`Product` (Task 9) are the single shared definition imported by Tasks 10, 11, 12 — no duplicate/divergent local interfaces.
- **No placeholders**: every step has real code; the only external actions (applying the migration, manual browser verification) are concrete, numbered procedures, not "TBD."
