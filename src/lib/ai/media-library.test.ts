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
