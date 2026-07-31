import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Media library: lets the autonomous auto-reply bot naturally decide,
// mid-conversation, to attach a product photo or catalog file --
// no scripted Flow/keyword trigger involved.
//
// The catalog is small and curated (a handful of products, a file or
// two each), so unlike the knowledge base there's no ranking/retrieval
// step: the whole menu (name + description) is listed in the system
// prompt and the model picks at most one, by id, via a sentinel (see
// defaults.ts / generate.ts). Each item may also carry a linked contact
// tag (`tag_id`), applied when the model flags the product as the
// topic of conversation, independently of whether it attaches a file.
// ============================================================

export interface MediaLibraryPromptItem {
  id: string
  name: string
  productLabel: string | null
  description: string
  tagId: string | null
  /** Price range, in the account's default currency (migration 053).
   * When BOTH are set, the assistant may share this as a caveated
   * estimate (see defaults.ts); when either is null, pricing for this
   * item stays reference-only under the absolute no-pricing rule,
   * exactly as before. */
  priceMin: number | null
  priceMax: number | null
  /** Free-form unit label paired with the range -- 'per_meter',
   * 'per_item', 'per_kg', etc. */
  priceUnit: string | null
  /** Free-text addon/option pricing not captured by the range (e.g.
   * "Automatic +$60, manual included; motor add-on +$50-80",
   * migration 053). Only ever surfaced alongside a configured range. */
  priceNotes: string | null
}

export interface MediaLibraryItem extends MediaLibraryPromptItem {
  storagePath: string
  mimeType: string
  mediaKind: 'image' | 'document'
}

/**
 * List every media-library item for the prompt. Best-effort: any
 * failure degrades to an empty list (no attach capability that turn)
 * rather than throwing into the auto-reply path.
 */
export async function listMediaLibraryForPrompt(
  db: SupabaseClient,
  accountId: string,
): Promise<MediaLibraryPromptItem[]> {
  try {
    const { data, error } = await db
      .from('ai_media_library')
      .select('id, name, product_label, description, tag_id, price_min, price_max, price_unit, price_notes')
      .eq('account_id', accountId)
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      productLabel: (row.product_label as string | null) ?? null,
      description: row.description as string,
      tagId: (row.tag_id as string | null) ?? null,
      priceMin: (row.price_min as number | null) ?? null,
      priceMax: (row.price_max as number | null) ?? null,
      priceUnit: (row.price_unit as string | null) ?? null,
      priceNotes: (row.price_notes as string | null) ?? null,
    }))
  } catch (err) {
    console.error('[ai media-library] listMediaLibraryForPrompt failed:', err)
    return []
  }
}

/**
 * Full record for the item the model picked, used to build the actual
 * Meta media send (storage path -> public URL, MIME/kind for the
 * WhatsApp payload). Null when the id doesn't exist (deleted mid-
 * conversation, or -- since the model is instructed never to invent
 * one -- a hallucinated id).
 */
export async function getMediaLibraryItem(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<MediaLibraryItem | null> {
  try {
    const { data, error } = await db
      .from('ai_media_library')
      .select(
        'id, name, product_label, description, tag_id, price_min, price_max, price_unit, price_notes, storage_path, mime_type, media_kind',
      )
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    return {
      id: data.id as string,
      name: data.name as string,
      productLabel: (data.product_label as string | null) ?? null,
      description: data.description as string,
      tagId: (data.tag_id as string | null) ?? null,
      priceMin: (data.price_min as number | null) ?? null,
      priceMax: (data.price_max as number | null) ?? null,
      priceUnit: (data.price_unit as string | null) ?? null,
      priceNotes: (data.price_notes as string | null) ?? null,
      storagePath: data.storage_path as string,
      mimeType: data.mime_type as string,
      mediaKind: data.media_kind as 'image' | 'document',
    }
  } catch (err) {
    console.error('[ai media-library] getMediaLibraryItem failed:', err)
    return null
  }
}
