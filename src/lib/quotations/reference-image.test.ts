import { describe, expect, it, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  normalizeReferenceImage,
  referenceImageDataUrl,
  verifyReferenceImage,
} from './reference-image-server';
import {
  validReferenceImage,
  REFERENCE_IMAGE_MAX_BYTES,
} from './reference-image';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({
  download: vi.fn(),
  single: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: h.eq }) }),
    storage: { from: () => ({ download: h.download }) },
  }),
}));
const quote = '10000000-0000-4000-8000-000000000001';
const image = {
  storagePath: `${quote}/20000000-0000-4000-8000-000000000001.jpg`,
  width: 100,
  height: 80,
  bytes: 123,
  mimeType: 'image/jpeg' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  h.eq.mockReturnValue({ eq: h.eq, maybeSingle: h.single });
  h.single.mockResolvedValue({ data: { image }, error: null });
});
describe('quotation picture validation and rendering', () => {
  it('accepts one bounded raster reference and rejects URLs, unknown fields, arrays and invalid dimensions', () => {
    expect(validReferenceImage(image)).toBe(true);
    for (const invalid of [
      null,
      [image],
      { ...image, extra: true },
      { ...image, storagePath: 'https://example.com/a.jpg' },
      { ...image, width: 2401 },
      { ...image, height: 1.5 },
      { ...image, bytes: 0 },
      { ...image, mimeType: 'image/svg+xml' },
    ])
      expect(validReferenceImage(invalid)).toBe(false);
  });
  it('decodes, orients, bounds and strips EXIF metadata from the image', async () => {
    const input = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: 'red' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const output = await normalizeReferenceImage(input);
    expect([output.width, output.height]).toEqual([800, 2400]);
    const meta = await sharp(output.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
  it('accepts real PNG/WebP contents, rejects spoofed, oversized, truncated and animated inputs', async () => {
    for (const format of ['png', 'webp'] as const) {
      const buffer = await sharp({
        create: { width: 30, height: 20, channels: 4, background: '#ff000080' },
      })
        [format]()
        .toBuffer();
      expect((await normalizeReferenceImage(buffer)).width).toBe(30);
      await expect(
        normalizeReferenceImage(buffer.subarray(0, 20))
      ).rejects.toThrow('referenceImageInvalid');
    }
    const gif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    for (const input of [
      Buffer.from('<svg></svg>'),
      Buffer.from('not a photo'),
      gif,
    ])
      await expect(normalizeReferenceImage(input)).rejects.toThrow(
        'referenceImageInvalid'
      );
    await expect(
      normalizeReferenceImage(Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES + 1))
    ).rejects.toThrow('referenceImageSize');
  });
  it('requires quotation/account ownership, readiness and exact registered metadata before storage download', async () => {
    const db = {
      from: () => ({ select: () => ({ eq: h.eq }) }),
    } as unknown as SupabaseClient;
    await verifyReferenceImage(db, quote, 'account', image);
    expect(h.eq).toHaveBeenCalledWith('account_id', 'account');
    expect(h.eq).toHaveBeenCalledWith('ready', true);
    await expect(
      verifyReferenceImage(db, 'other', 'account', image)
    ).rejects.toThrow('referenceImageInvalid');
    await expect(
      verifyReferenceImage(db, quote, 'account', { ...image, width: 90 })
    ).rejects.toThrow('referenceImageInvalid');
    h.single.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      verifyReferenceImage(db, quote, 'account', image)
    ).rejects.toThrow('referenceImageInvalid');
    expect(h.download).not.toHaveBeenCalled();
  });
  it('embeds authenticated bytes and fails closed on unavailable or incomplete storage', async () => {
    expect(
      await referenceImageDataUrl({ id: quote, accountId: 'account' })
    ).toBeUndefined();
    h.download.mockResolvedValueOnce({
      data: new Blob([Buffer.alloc(image.bytes)]),
      error: null,
    });
    expect(
      await referenceImageDataUrl({
        id: quote,
        accountId: 'account',
        documentDetails: { referenceImage: image },
      })
    ).toMatch(/^data:image\/jpeg;base64,/);
    h.download.mockResolvedValueOnce({
      data: null,
      error: { message: 'missing' },
    });
    await expect(
      referenceImageDataUrl({
        id: quote,
        accountId: 'account',
        documentDetails: { referenceImage: image },
      })
    ).rejects.toThrow('referenceImageUnavailable');
    h.download.mockResolvedValueOnce({
      data: new Blob(['short']),
      error: null,
    });
    await expect(
      referenceImageDataUrl({
        id: quote,
        accountId: 'account',
        documentDetails: { referenceImage: image },
      })
    ).rejects.toThrow('referenceImageUnavailable');
  });
});
