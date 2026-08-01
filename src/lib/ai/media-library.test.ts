import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listMediaLibraryForPrompt, getMediaLibraryItem } from './media-library'

function fakeDb(opts: {
  listRows?: unknown[] | null
  listError?: unknown
  singleRow?: unknown | null
  singleError?: unknown
}): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: opts.singleRow ?? null, error: opts.singleError ?? null }),
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: opts.listRows ?? null, error: opts.listError ?? null }),
  }
  return chain as unknown as SupabaseClient
}

describe('listMediaLibraryForPrompt', () => {
  it('maps price_min/price_max/price_unit/price_notes through to camelCase', async () => {
    const db = fakeDb({
      listRows: [
        {
          id: 'm-1',
          name: 'Velvet fabric',
          product_label: 'Fabric',
          description: 'Soft velvet',
          tag_id: 'tag-1',
          price_min: 80,
          price_max: 120,
          price_unit: 'per_meter',
          price_notes: 'Motor add-on +$50-80',
        },
      ],
    })
    const items = await listMediaLibraryForPrompt(db, 'acc-1')
    expect(items).toEqual([
      {
        id: 'm-1',
        name: 'Velvet fabric',
        productLabel: 'Fabric',
        description: 'Soft velvet',
        tagId: 'tag-1',
        priceMin: 80,
        priceMax: 120,
        priceUnit: 'per_meter',
        priceNotes: 'Motor add-on +$50-80',
      },
    ])
  })

  it('defaults price fields to null when absent', async () => {
    const db = fakeDb({
      listRows: [
        {
          id: 'm-2',
          name: 'Brochure',
          product_label: null,
          description: 'PDF catalog',
          tag_id: null,
          price_min: null,
          price_max: null,
          price_unit: null,
          price_notes: null,
        },
      ],
    })
    const [item] = await listMediaLibraryForPrompt(db, 'acc-1')
    expect(item.priceMin).toBeNull()
    expect(item.priceMax).toBeNull()
    expect(item.priceUnit).toBeNull()
    expect(item.priceNotes).toBeNull()
  })

  it('returns [] on a query error', async () => {
    const db = fakeDb({ listRows: null, listError: new Error('boom') })
    expect(await listMediaLibraryForPrompt(db, 'acc-1')).toEqual([])
  })
})

describe('getMediaLibraryItem', () => {
  it('returns the full record including price range fields', async () => {
    const db = fakeDb({
      singleRow: {
        id: 'm-1',
        name: 'Velvet fabric',
        product_label: 'Fabric',
        description: 'Soft velvet',
        tag_id: 'tag-1',
        price_min: 80,
        price_max: 120,
        price_unit: 'per_meter',
        price_notes: 'Motor add-on +$50-80',
        storage_path: 'library/m-1.jpg',
        mime_type: 'image/jpeg',
        media_kind: 'image',
      },
    })
    const item = await getMediaLibraryItem(db, 'acc-1', 'm-1')
    expect(item).toEqual({
      id: 'm-1',
      name: 'Velvet fabric',
      productLabel: 'Fabric',
      description: 'Soft velvet',
      tagId: 'tag-1',
      priceMin: 80,
      priceMax: 120,
      priceUnit: 'per_meter',
      priceNotes: 'Motor add-on +$50-80',
      storagePath: 'library/m-1.jpg',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    })
  })

  it('returns null when the id does not exist', async () => {
    const db = fakeDb({ singleRow: null })
    expect(await getMediaLibraryItem(db, 'acc-1', 'missing')).toBeNull()
  })
})
