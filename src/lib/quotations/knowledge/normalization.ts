import type { KnowledgeRecord } from './types';

/** Company documents establish the evidence. Normalize presentation, never invent
 * missing commercial choices or mutate the original strings/snapshot labels. */
export function cleanCompanyText(value: string): string {
  return value
    .normalize('NFC')
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b\u200e\u200f\ufeff]/g,
      ''
    )
    .replace(/\bqut(?:ation|ations)\b/gi, (m) =>
      m.toLowerCase().endsWith('s') ? 'quotations' : 'quotation'
    )
    .replace(/\bquatation\b/gi, 'quotation')
    .replace(/\bpolycarbonaite\b/gi, 'polycarbonate')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
export const PRODUCT_NAMES: Record<string, string> = {
  WS: 'Aluminium Roller Window Shutters',
  RSD: 'Rolling Shutter Doors',
  SEC: 'Sectional Garage Doors',
  PG: 'Pergolas and Roof Systems',
  AL: 'Aluminium Windows and Doors',
  GL: 'Glass Partitions and Glazing',
  UPVC: 'uPVC Windows and Doors',
  PIV: 'Pivot Entrance Doors',
  SD: 'Steel Doors',
  FSD: 'Fire-rated Steel Doors',
  SL: 'Sliding Gate Automation',
  SW: 'Swing Gate Automation',
  GB: 'Parking Barriers',
  SP: 'Automatic Pool Covers',
  HSD: 'High-speed PVC Doors',
  MOT: 'Motors, Operators and Accessories',
};
const alufixEnglish =
  /\b(?:M-SHAPED|C-SHAPED|SIDE LOCK|TUBE CAP|EXTENSION CAP|TRANSM[Iİ]SS[Iİ]ON CAP|ALUMINUM EXTENSION|TUBE FITTING|CRANK|HANDCRANK|PULLEY|STOPPER|CONVECTOR RING|M[Iİ]N[Iİ] ENTRY GUIDE|ENTRY GUIDE|SECURITY SPRING|BEARING|BRACKET|SQUARE BRACKET|TRIANGULAR BRACKET|OVAL BRACKET|STAR-SHAPED BRACKET|TAPE COILER|METAL STRAP GUIDE|PLAST[Iİ]C STRAP GUIDE|BOTTOM SEAL|MANUEL LOCK|COVER PLATE|ALUMINUM SIDE CAP|GALVANIZED SIDE CAP|ROUND SHUTTER DRUM|ROUND AWN[Iİ]NG|FLYSCREEN|BINDER PAD|HANDLE|HINGE|CORNER PLASTIC|SLIDING HANDLE|SLIDING ROLLER|GASKET)\b/;
export function normalizedItemName(input: string): string {
  const original = cleanCompanyText(input);
  const part = original.match(/^([A-Z]{2}(?:[.-][A-Z0-9]+)+):\s*(.*)$/);
  let text = original;
  if (part) {
    const [, code, body] = part,
      start = body.search(alufixEnglish);
    if (start < 0) return `Alufix Accessory — ${code}`;
    text = body
      .slice(start)
      .replaceAll('İ', 'I')
      .toLowerCase()
      .replace(/\baluminum\b/g, 'aluminium')
      .replace(/\bplastıc\b/g, 'plastic')
      .replace(/\bmanuel\b/g, 'manual')
      .replace(/\btranformable\b/g, 'transformable')
      .replace(/\bcristal\b/g, 'crystal')
      .replace(/\balm\b/g, 'aluminium');
    // Dimensions immediately before the English description survive bilingual extraction.
    const dims = [
      ...body
        .slice(0, start)
        .matchAll(/\b\d+(?:[.,]\d+)?\s*[xX]\s*\d+(?:[.,]\d+)?(?:\s*mm)?/g),
    ].at(-1)?.[0];
    if (dims && !text.toLowerCase().includes(dims.toLowerCase()))
      text += `, ${dims}`;
    const nominal = [
      ...body.slice(0, start).matchAll(/\b(\d+(?:[.,]\d+)?)\s*mm\b/g),
    ].at(-1)?.[1];
    if (nominal && !new RegExp(`\\b${nominal}\\s*mm\\b`, 'i').test(text))
      text += `, ${nominal} mm`;
    if (
      /^(YK|GK)[.-]/.test(code) &&
      /45[°’]/.test(body) &&
      !text.includes('45°')
    )
      text += ', 45°';
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return `${finishItemText(text)} — ${code}`;
  }
  return finishItemText(text);
}
function finishItemText(text: string) {
  return text
    .replace(/\bPU\b/g, 'polyurethane-filled')
    .replace(/\bTube motor\b/gi, 'Tubular motor')
    .replace(/\bCONVECTOR RING\b/gi, 'Tube adaptor ring')
    .replace(/\bFlasher light\b/gi, 'Warning light')
    .replace(/\bLift Master\b/g, 'LiftMaster')
    .replace(/\bVision glass panel\b/gi, 'Sectional door vision panel')
    .replace(
      /Pass door \(small door inside sectional door\)/gi,
      'Integrated sectional pedestrian door'
    )
    .replace(
      /\bFarshy\s*(\d+)\s*mm\s*\((?:Weather strip )?Grey\)/gi,
      'Grey brush weatherstrip, $1 mm'
    )
    .replace(
      /\bEnd slat for (\d+)mm slat WHITE color, \(RAL (\d+)\)/gi,
      'Bottom rail for $1 mm slats, white (RAL $2)'
    )
    .replace(
      /\bEnd slat for (\d+)mm slat IVORY color, regular/gi,
      'Bottom rail for $1 mm slats, ivory'
    )
    .replace(
      /\bSide Frame (\d+)mm (White|Ivory) 45 degree/gi,
      'Shutter side frame, $1 mm, $2, 45°'
    )
    .replace(/\bdia\s*(\d+)/gi, 'Ø$1')
    .replace(/\bdeg\b/g, '°')
    .replace(/(\d)\s*[xX]\s*(?=\d)/g, '$1 × ')
    .replace(/(\d)(mm|kg|cm)\b/g, '$1 $2')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
export function recordDisplayLabel(r: KnowledgeRecord, ar = false) {
  const d = r.data;
  if (r.kind === 'product' && ar && d.product_ar)
    return cleanCompanyText(d.product_ar);
  if (r.kind === 'grid')
    return `${normalizedScreenName(`${d.product} ${d.mesh_and_motor}`)} · ${d.width_cm} × ${d.height_cm} cm`;
  if (r.kind === 'product')
    return (
      PRODUCT_NAMES[d.code] ?? cleanCompanyText(d.product_en ?? r.record_key)
    );
  if (r.kind === 'supplier_code')
    return normalizedItemName(
      `${d.alufix_code}: ${d['name_text_as_extracted (Turkish / English)'] ?? ''}`
    );
  return normalizedItemName(
    d.item_en ||
      d.description ||
      d.component ||
      d.client_key ||
      d.Client ||
      d.file ||
      d.item ||
      d.product ||
      r.record_key
  );
}
export function sourceProvenance(kind: string, ar: boolean) {
  if (['grid', 'supplier', 'supplier_code'].includes(kind))
    return ar
      ? 'سجل مورد من أرشيف الشركة'
      : 'Supplier record from company archive';
  if (
    [
      'document',
      'coverage',
      'merge',
      'bom_rule',
      'bom_example',
      'superseded',
    ].includes(kind)
  )
    return ar
      ? 'معلومات مستخلصة من سجلات الشركة'
      : 'Derived from company records';
  return ar ? 'موثق بسجلات الشركة' : 'Documented in company records';
}
export function sourceReadyToApply(r: KnowledgeRecord) {
  if (r.review_status !== 'approved') return false;
  if (['price', 'grid'].includes(r.kind)) return !!r.configuration.pricing;
  if (r.kind === 'product') return !!r.configuration.catalogItemId;
  if (r.kind === 'supplier') return !!r.configuration.supplierCost;
  return true;
}
export function sourceFieldLabel(key: string) {
  const labels: Record<string, string> = {
    item_id: 'Item code',
    item_en: 'Item',
    item_ar_source: 'Original Arabic description',
    product_en: 'Product',
    product_ar: 'Arabic name',
    what_is_included: 'Included scope',
    price_anchor_2026: 'Recorded pricing',
    standard_payment: 'Payment practice',
    standard_delivery: 'Delivery practice',
    warranty: 'Recorded warranty',
    source_code_or_size: 'Source code / size',
    col_O: 'Price column O',
    col_P: 'Price column P',
    col_R: 'Price column R',
    col_S: 'Price column S',
    id_status: 'Code origin',
    suppliers_and_offers: 'Supplier offers',
    mesh_and_motor: 'Fabric and motor',
    match_confidence: 'Matching evidence',
    merged_from_ids: 'Original item codes',
  };
  return (
    labels[key] ??
    key
      .replaceAll('_', ' ')
      .replace(/\s+/g, ' ')
      .replace(/^./, (m) => m.toUpperCase())
  );
}
export function sourceDisplayValue(key: string, value: string) {
  if (
    /(?:^|[_\s])(?:file|filename|ref|reference|code|path|folder)(?:$|[_\s])/i.test(
      key
    )
  )
    return value;
  if (['item_en', 'description', 'component', 'item'].includes(key))
    return normalizedItemName(value);
  if (key === 'product_en') return cleanCompanyText(value);
  return cleanCompanyText(value);
}

export function normalizedScreenName(text: string) {
  const upper = text.replaceAll('İ', 'I').toUpperCase();
  const system = upper.includes('ELECTROOF')
    ? 'Electroof 140'
    : 'Electroll 103';
  const fabric = upper.includes('COPACO')
    ? 'Copaco Sunscreen'
    : /FERRARI\s*86/.test(upper)
      ? 'Soltis 86 Sunscreen'
      : /FERRARI\s*92/.test(upper)
        ? 'Soltis 92 Sunscreen'
        : upper.includes('STRONG')
          ? 'Reinforced Flyscreen'
          : upper.includes('SUNSCREEN')
            ? 'Horizontal Sunscreen'
            : 'Flyscreen';
  const motor = upper.includes('MOSEL')
    ? 'Mosel'
    : upper.includes('SOMFY')
      ? 'Somfy'
      : '';
  return [system, fabric, motor].filter(Boolean).join(' · ');
}

/** Normalize equivalent quantity-unit names only. Purchasing lengths/conversions
 * such as 6M and 1-6M remain as written until their meaning is established. */
export function normalizedQuantityUnit(
  value: string | null | undefined
): string | null {
  if (!value?.trim()) return null;
  const units: Record<string, string> = {
    'per unit': 'piece',
    'per motor': 'piece',
    'per pc': 'piece',
    'per piece': 'piece',
    'per unit (as written)': 'piece',
    pec: 'piece',
    pcs: 'piece',
    'per m': 'm',
    mts: 'm',
    'per m2': 'm2',
    'per set': 'set',
    pair: 'pair',
    roll: 'roll',
  };
  return units[value.trim().toLowerCase()] ?? value.trim();
}
