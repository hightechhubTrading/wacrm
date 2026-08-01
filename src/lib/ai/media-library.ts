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
