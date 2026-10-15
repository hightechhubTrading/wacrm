import type { QuotationItemToSave } from './crud';

export const PRODUCT_STARTERS = [
  { key: 'pivotDoor', en: 'Pivot door', ar: 'باب محوري' },
  { key: 'rollerShutter', en: 'Roll-up shutter', ar: 'باب رول' },
  {
    key: 'gateAutomation',
    en: 'Swing gate automation',
    ar: 'نظام تشغيل بوابة مفصلية',
  },
  { key: 'steelDoor', en: 'Steel door', ar: 'باب حديد' },
  { key: 'upvc', en: 'UPVC door / window', ar: 'باب / نافذة UPVC' },
  {
    key: 'installation',
    en: 'Installation service',
    ar: 'خدمة التركيب',
    service: true,
  },
] as const;
export const ACCESSORY_STARTERS = [
  { key: 'motor', en: 'Motor', ar: 'محرك' },
  { key: 'pushButton', en: 'Push button', ar: 'زر تشغيل' },
  {
    key: 'boxSheet',
    en: 'Box sheet (0.5 mm L-type)',
    ar: 'بوكس داخلي (0.5 مم)',
  },
  { key: 'sideFrame', en: 'Steel side frame', ar: 'فريم حديد جانبي' },
  { key: 'frontDecor', en: 'Front decoration', ar: 'ديكور أمامي' },
  { key: 'remote', en: 'Remote control', ar: 'ريموت تحكم' },
  { key: 'lock', en: 'Lock', ar: 'قفل' },
  { key: 'handle', en: 'Handle', ar: 'مقبض' },
] as const;
export function nextItemCode(
  items: QuotationItemToSave[],
  prefix: string
): string {
  const used = new Set(
    items.flatMap((item) => {
      const match = item.itemCode
        ?.toUpperCase()
        .match(new RegExp(`^${prefix}(\\d+)$`));
      return match ? [Number(match[1])] : [];
    })
  );
  let index = 1;
  while (used.has(index)) index++;
  return `${prefix}${String(index).padStart(2, '0')}`;
}
export function convertDimensions(
  item: QuotationItemToSave,
  nextUnit: string
): Pick<QuotationItemToSave, 'sizeW' | 'sizeH' | 'measurementUnit'> {
  const units: Record<string, number> = { mm: 1, cm: 10, m: 1000 };
  const factor =
    (units[item.measurementUnit ?? 'mm'] ?? 1) / (units[nextUnit] ?? 1);
  const convert = (n: number | undefined) =>
    n === undefined ? undefined : Math.round(n * factor * 1e6) / 1e6;
  return {
    sizeW: convert(item.sizeW),
    sizeH: convert(item.sizeH),
    measurementUnit: nextUnit,
  };
}
