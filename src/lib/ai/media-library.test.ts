import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listProductsForPrompt, getProductMediaItem, captionProductMediaFile } from './media-library'

const h = vi.hoisted(() => ({
  loadImageAnalysisKey: vi.fn(),
  analyzeImage: vi.fn(),
}))

vi.mock('./config', () => ({ loadImageAnalysisKey: h.loadImageAnalysisKey }))
vi.mock('./vision', () => ({ analyzeImage: h.analyzeImage }))

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
