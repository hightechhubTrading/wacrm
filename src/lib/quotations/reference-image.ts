/** Shared contract: storage paths, never arbitrary remote URLs. */
export const REFERENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REFERENCE_IMAGE_MAX_EDGE = 2400;
export interface QuotationReferenceImage {
  storagePath: string;
  mimeType: 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
}
const pathPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i;
export function validReferenceImage(
  value: unknown
): value is QuotationReferenceImage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const image = value as QuotationReferenceImage;
  return (
    Object.keys(image).length === 5 &&
    typeof image.storagePath === 'string' &&
    pathPattern.test(image.storagePath) &&
    image.mimeType === 'image/jpeg' &&
    Number.isInteger(image.bytes) &&
    image.bytes > 0 &&
    image.bytes <= REFERENCE_IMAGE_MAX_BYTES &&
    [image.width, image.height].every(
      (n) => Number.isInteger(n) && n > 0 && n <= REFERENCE_IMAGE_MAX_EDGE
    )
  );
}
