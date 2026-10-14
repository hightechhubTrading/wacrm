import type { ProductPromptItem } from '../media-library';

/** A narrow deterministic check for explicitly currency-labelled base prices.
 * Descriptive/add-on pricing remains a separate semantic question; this does
 * not attempt to calculate area, taxes, discounts or a final quotation. */
export function priceOutsideRange(
  text: string,
  product: ProductPromptItem | undefined
): boolean {
  if (
    !product ||
    product.priceMin == null ||
    product.priceMax == null ||
    product.priceNotes?.trim()
  )
    return false;
  const normalized = text
    .replace(/[٠-٩]/g, (s) => String(s.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (s) => String(s.charCodeAt(0) - 0x6f0))
    .replace(/٬/g, ',')
    .replace(/٫/g, '.');
  const amount = '\\d+(?:,\\d{3})*(?:\\.\\d+)?';
  const range = `(${amount})(?:\\s*(?:[-–—]|to|إلى|الى|حتى)\\s*(${amount}))?`;
  const currency =
    '(?:QAR|QR|USD|AED|SAR|EUR|GBP|ريال(?:\\s+قطري)?|درهم|دولار|يورو|ر\\.ق)';
  const patterns = [
    new RegExp(`${currency}\\s*${range}`, 'gi'),
    new RegExp(`${range}\\s*${currency}`, 'gi'),
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      for (const value of match.slice(1).filter(Boolean)) {
        const number = Number(value.replaceAll(',', ''));
        if (number < product.priceMin || number > product.priceMax) return true;
      }
    }
  }
  return false;
}
