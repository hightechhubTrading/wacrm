import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './admin-client';
import {
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MAX_EDGE,
  validReferenceImage,
  type QuotationReferenceImage,
} from './reference-image';

export const REFERENCE_IMAGE_BUCKET = 'quotation-images';
export class ReferenceImageError extends Error {
  constructor(
    message = 'referenceImageUnavailable',
    public readonly status = 503
  ) {
    super(message);
  }
}

/** Decode raster contents, reject animated/multipage files, rotate and strip metadata. */
export async function normalizeReferenceImage(input: Buffer) {
  if (!input.length || input.length > REFERENCE_IMAGE_MAX_BYTES)
    throw new ReferenceImageError('referenceImageSize', 400);
  try {
    const image = sharp(input, {
      limitInputPixels: 40_000_000,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Unsupported image');
    const { data, info } = await image
      .autoOrient()
      .resize({
        width: REFERENCE_IMAGE_MAX_EDGE,
        height: REFERENCE_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > REFERENCE_IMAGE_MAX_BYTES)
      throw new Error('Image too large');
    return {
      data,
      width: info.width,
      height: info.height,
      bytes: data.length,
      mimeType: 'image/jpeg' as const,
    };
  } catch {
    throw new ReferenceImageError('referenceImageInvalid', 400);
  }
}

/** Registry is server-written; exact metadata and quotation/account ownership must match. */
export async function verifyReferenceImage(
  db: SupabaseClient,
  quotationId: string,
  accountId: string,
  image: unknown
) {
  if (
    !validReferenceImage(image) ||
    !image.storagePath.startsWith(`${quotationId}/`)
  )
    throw new ReferenceImageError('referenceImageInvalid', 400);
  const { data, error } = await db
    .from('quotation_images')
    .select('image')
    .eq('storage_path', image.storagePath)
    .eq('quotation_id', quotationId)
    .eq('account_id', accountId)
    .eq('ready', true)
    .eq('deleting', false)
    .maybeSingle();
  if (error) throw new ReferenceImageError();
  if (
    !data ||
    JSON.stringify(Object.entries(data.image).sort()) !==
      JSON.stringify(Object.entries(image).sort())
  )
    throw new ReferenceImageError('referenceImageInvalid', 400);
}

export async function loadReferenceImage(
  quotationId: string,
  accountId: string,
  image: QuotationReferenceImage
): Promise<Buffer> {
  const db = supabaseAdmin();
  await verifyReferenceImage(db, quotationId, accountId, image);
  const { data, error } = await db.storage
    .from(REFERENCE_IMAGE_BUCKET)
    .download(image.storagePath);
  if (error || !data || data.size !== image.bytes)
    throw new ReferenceImageError();
  return Buffer.from(await data.arrayBuffer());
}

export async function referenceImageDataUrl(q: {
  id: string;
  accountId: string;
  documentDetails?: { referenceImage?: QuotationReferenceImage };
}) {
  const image = q.documentDetails?.referenceImage;
  if (!image) return undefined;
  const bytes = await loadReferenceImage(q.id, q.accountId, image);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}
