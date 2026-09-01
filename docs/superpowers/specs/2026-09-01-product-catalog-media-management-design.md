# Product catalog media management

Date: 2026-09-01

## Problem

The AI product catalog (`ai_products` / `ai_product_media`, migration
057) has three problems today, all in
`src/components/settings/ai-media-library.tsx`:

1. **Uploaded files are invisible.** The card lists each file as a
   generic icon + label — never an actual thumbnail — even though
   `GET /api/ai/products` already returns `storage_path` and the
   `ai-media` bucket is public. There's no way to see what you
   actually uploaded, or view it full-size.
2. **Upload is one file at a time**, with a label field you have to
   fill in before each individual upload. Loading a product's full
   photo set is tedious.
3. **The AI's per-file understanding is manual-label-only.** The
   system prompt gets each file's `id`/`label`/`mediaKind` and nothing
   about what's actually in the image
   (`src/lib/ai/defaults.ts:396`). A product with five photos (front
   view, installed, black color, with motor...) is only
   distinguishable to the model if a human typed a precise label for
   every single one.

The card is also buried at the bottom of the Agent settings page
(`ai-config.tsx`), a long scrolling form focused on prompt/behavior
config — not a good home for what is, in practice, the business's
product/photo reference library.

## Goals

- Every uploaded file renders as a real thumbnail (images) or a
  labeled file chip (documents), with a full-size preview.
- Drag-and-drop or multi-select batch upload onto a product, with
  live per-file progress.
- Each image gets a short AI-generated description on upload —
  reusing the existing photo-analysis pipeline that already captions
  inbound customer photos — so the agent can tell photos of the same
  product apart and match a specific client request (color, angle,
  installed vs. boxed, with/without a visible part) to the right
  file. This is additive to the existing human `label`, not a
  replacement for it.
- A description is human-editable and re-generatable, so a bad AI
  guess can be corrected and existing (pre-feature) photos can be
  backfilled after the fact.
- The catalog gets its own settings section with room for a real
  product list + photo grid, instead of a card wedged into Agent
  settings.

## Non-goals

- Any change to the `ai-media` bucket layout, RLS, or
  `MEDIA_MAX_BYTES_BY_KIND` limits.
- Multi-file attach in one AI reply — stays one file per reply
  (unchanged from migration 057).
- Reordering/pinning files within a product, or a "primary photo"
  concept. The grid is unordered (by upload time); the AI picks by
  label + description, not position.
- An "unsorted inbox" for photos not yet assigned to a product.
  Batch drops always target one specific product (confirmed with
  user — matches today's one-product-owns-its-files model).
- Fixing the inbox manual catalog picker
  (`src/components/inbox/catalog-picker-dialog.tsx`). It has the same
  no-thumbnail gap, but it's a separate flow (agent picking a file to
  send mid-conversation) — noted here as a known follow-up, not part
  of this spec.
- A background job queue. Captioning happens inline in the existing
  per-file upload-registration request; see Architecture.

## Architecture

### Data model

```sql
ALTER TABLE ai_product_media
  ADD COLUMN IF NOT EXISTS ai_description text;
```

New migration (`supabase/migrations/063_...sql` — next free number;
verify at implementation time). `ai_description` is nullable: `NULL`
until an image is captioned (never configured, captioning failed, or
the file is a document — documents are never sent to vision).

### Auto-captioning flow

Reuses `analyzeImage` (`src/lib/ai/vision.ts`) and
`loadImageAnalysisKey` (`src/lib/ai/config.ts`) exactly as they exist
today for inbound customer photos — no new prompt, no new provider
code.

`POST /api/ai/products/[id]/media` (existing route — registers a file
whose bytes the client already uploaded to Storage): after the insert,
when `media_kind === 'image'`:

1. `loadImageAnalysisKey(supabase, accountId)` — if no key/not
   enabled, skip (row keeps `ai_description: null`, response
   unchanged from today).
2. Download the object just written:
   `supabase.storage.from('ai-media').download(storagePath)` →
   `Buffer.from(await blob.arrayBuffer())`.
3. `analyzeImage({ provider, apiKey, imageBuffer, mimeType })` — no
   `conversationContext` (there is no conversation; this is catalog
   upload, not an inbound message).
4. On success, `UPDATE ai_product_media SET ai_description = ...`
   and include it in the response body. On any failure (network,
   provider error, empty response), log and continue — the file
   registration already succeeded and must not roll back or fail the
   request over a best-effort caption, matching `vision.ts`'s existing
   contract.

This keeps every request short (~2–5s added for one vision call) and
needs no queue: batch upload gets its concurrency from the *client*
firing several of these requests at once (see below), not from
server-side fan-out.

**Regenerate**: same three steps (2–4 above), factored into a small
shared helper (e.g. `captionProductMediaFile(supabase, accountId,
fileId)` in `src/lib/ai/media-library.ts`) called both from the POST
route above and from a new endpoint:

```
POST /api/ai/products/[id]/media/[fileId]/regenerate   (admin+)
```

Re-runs captioning for one existing file (used for backfilling old
photos, or retrying after enabling vision post-upload). Same
best-effort semantics; 404 if the file isn't found, 400 if it isn't
an image.

**Manual edit**: `PATCH /api/ai/products/[id]/media/[fileId]` already
edits `label`; extend it to also accept `ai_description` (string or
null) in the same body, so a human can hand-correct a bad caption
without a regenerate round-trip.

### AI-facing changes

`src/lib/ai/media-library.ts`:
- `ProductMediaFilePromptItem` gains `aiDescription: string | null`.
- `listProductsForPrompt`'s select adds `ai_description` to the
  `ai_product_media(...)` embed and maps it through.

`src/lib/ai/defaults.ts` (`buildSystemPrompt`, line ~396) — file line
format changes from:

```
  - [${f.id}] ${f.label ? f.label + ' ' : ''}(${f.mediaKind})
```

to also append the description when present, e.g.:

```
  - [${f.id}] ${f.label ? f.label + ' ' : ''}(${f.mediaKind})${f.aiDescription ? ': ' + f.aiDescription : ''}
```

No other prompt-building logic changes — `auto-reply.ts` and
`src/app/api/ai/playground/route.ts` both just pass
`listProductsForPrompt`'s result through to `buildSystemPrompt`
unchanged.

### Settings UI

**New rail section** — `src/components/settings/settings-sections.ts`:
add `'products'` to `SETTINGS_SECTIONS`, and to `SECTION_META`:

```ts
products: { id: 'products', label: 'Product catalog', icon: Package, group: 'workspace' },
```

`src/app/(dashboard)/settings/page.tsx`: add `products:
<ProductCatalogPanel />` to the `panel` map; import it.

**New component** `src/components/settings/product-catalog.tsx`
(`ProductCatalogPanel`), replacing `ai-media-library.tsx` and removed
from `ai-config.tsx` (drop the `AiMediaLibraryCard` import/usage at
`ai-config.tsx:667`). Self-contained like its sibling panels
(`template-manager.tsx`) — resolves `accountId`/`canEdit` itself via
`useAuth()` + `canEditSettings(accountRole)` rather than taking them
as props.

Layout: two-pane, `grid lg:grid-cols-[280px_minmax(0,1fr)]` (mirrors
the outer settings rail split):

- **Left** — product list: name, price range badge, file count.
  "+ Add product" at the top. Selecting a product loads its detail
  into the right pane.
- **Right** — selected product's info form (name, tag label,
  price min/max/unit, price notes, description — same fields as
  today, same validation) collapsed into a compact header block,
  with the photo/file grid below it:
  - Drop zone spanning the grid (drag-and-drop) + a "Select files"
    button, both accepting multiple files
    (`<input type="file" multiple>`).
  - Each file renders as a thumbnail card: `<img>` via
    `supabase.storage.from('ai-media').getPublicUrl(storage_path)`
    for images (mirrors the URL-building already done in
    `catalog-picker-dialog.tsx:92`), a file-type icon + extension
    chip for documents.
  - Thumbnail caption: label if set, else a truncated
    `ai_description`, else "(untitled)".
  - Click a thumbnail → `Dialog` (existing `ui/dialog.tsx`) showing
    the full-size image/file, editable label, editable AI
    description with a "Regenerate" button, and delete.
  - Mid-upload, a thumbnail shows a placeholder + spinner with a
    status label (`Uploading…` → `Describing…` → done), replaced
    in place as each file's registration request resolves — no full
    list refetch needed per file, only on batch completion (or
    optimistic local state updates directly).
  - Batch drops upload with a concurrency cap of 3 concurrent
    `uploadAccountMedia` + `POST .../media` pairs (simple
    in-component queue — `Promise.allSettled` over chunks of 3), no
    label pre-fill (label field is removed from the *batch* path;
    it's still editable per-file afterward via the existing
    edit-label affordance carried over from today's UI).

Routes touched:
- `POST /api/ai/products/[id]/media` — add captioning step (above).
- `PATCH /api/ai/products/[id]/media/[fileId]` — accept
  `ai_description` alongside `label`.
- New `POST /api/ai/products/[id]/media/[fileId]/regenerate`.
- All other routes (`GET/POST /api/ai/products`,
  `GET/PATCH/DELETE /api/ai/products/[id]`,
  `DELETE .../media/[fileId]`) unchanged.

## Tests

- `src/lib/ai/media-library.test.ts` — extend for `aiDescription` in
  `listProductsForPrompt`'s mapping.
- New `src/lib/ai/defaults.test.ts` (or extend if one exists by
  implementation time) — file-line formatting includes the
  description when present, omits the trailing `:` when absent.
- `src/app/api/ai/products/[id]/media/route.test.ts` (new) — POST
  captions on success, skips silently when vision isn't configured,
  and still returns 200 with the row saved when `analyzeImage` throws.
- `src/app/api/ai/products/[id]/media/[fileId]/route.test.ts`
  (new/extend) — PATCH accepts `ai_description`; new `regenerate`
  route file gets its own test (success, 404, non-image 400).

## Rollout

Single migration (additive column, safe/idempotent) + code change, no
feature flag. Existing files simply have `ai_description: null` until
opened and regenerated, or re-uploaded — no backfill migration needed
since regenerate covers it on demand.
