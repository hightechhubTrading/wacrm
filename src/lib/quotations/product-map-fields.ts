import type { ProductField } from './product-profile';

export const productMapFieldLabels: Record<string, [string, string]> = {
  operation: ['Operation', 'طريقة التشغيل'],
  usedFor: ['Used for', 'الاستخدام'],
  finish: ['Colour / finish', 'اللون / التشطيب'],
  box: ['Box shape', 'شكل البوكس'],
  window: ['Window shape', 'شكل النافذة'],
  motorPosition: ['Motor position', 'مكان المحرك'],
  panel: ['Panel pattern', 'نقشة اللوح'],
  sheet: ['Sheet height', 'ارتفاع الصاج'],
  boxCover: ['Box cover', 'غطاء البوكس'],
  motor: ['Motor type', 'نوع المحرك'],
  control: ['Control', 'التحكم'],
  slatProfile: ['Slat profile', 'مقطع الشريحة'],
  leaves: ['Leaves', 'عدد الدرف'],
  material: ['Material', 'المادة'],
  design: ['Design', 'التصميم'],
  power: ['Power', 'الكهرباء'],
  handle: ['Handle', 'المقبض'],
  lock: ['Lock', 'القفل'],
  hinges: ['Hinges', 'المفصلات'],
  panels: ['Number of panels', 'عدد الألواح'],
  glass: ['Glass', 'الزجاج'],
  flyscreen: ['Flyscreen', 'شبك الحشرات'],
  opening: ['Opening arrangement', 'طريقة الفتح'],
  framing: ['Frame', 'الإطار'],
  door: ['Door', 'الباب'],
  mounting: ['Mounting', 'طريقة التثبيت'],
  rating: ['Rating (minutes), with certificate', 'التصنيف بالدقائق مع الشهادة'],
  lighting: ['Lighting', 'الإضاءة'],
};
const keys: Record<string, string> = {
  Box: 'box',
  Window: 'window',
  'Motor position': 'motorPosition',
  Panel: 'panel',
  Sheet: 'sheet',
  'Box cover': 'boxCover',
  Motor: 'motor',
  Control: 'control',
  'Slat profile': 'slatProfile',
  Leaves: 'leaves',
  Material: 'material',
  Design: 'design',
  Power: 'power',
  Handle: 'handle',
  Lock: 'lock',
  Hinges: 'hinges',
  Glass: 'glass',
  Flyscreen: 'flyscreen',
  Opening: 'opening',
  Rating: 'rating',
  Lighting: 'lighting',
};
const field = (key: string, options?: string[]): ProductField => ({
  key,
  en: productMapFieldLabels[key][0],
  ar: productMapFieldLabels[key][1],
  ...(options ? { options } : {}),
});
/** Structured questions from the explicit owner-directed specification line.
 * Ordinary archive prose is never parsed into selectable supply claims.
 */
export function productMapFields(
  name: string,
  specifications: string
): ProductField[] | null {
  const line = specifications.match(/^Configuration choices: (.+)$/m)?.[1];
  if (!line) return null;
  const fields = [
    field('operation'),
    field(
      'finish',
      /^Window Shutter (41|55)$/.test(name) ? ['Beige', 'White'] : undefined
    ),
    field('usedFor'),
  ];
  for (const part of line
    .replace(/\.$/, '')
    .split(';')
    .map((s) => s.trim())) {
    const colon = part.indexOf(':');
    const key = colon >= 0 ? keys[part.slice(0, colon)] : undefined;
    if (key) {
      const value = part
        .slice(colon + 1)
        .trim()
        .replace(/, with certificate.*$/, '');
      const options = value.split('|').map((s) => s.trim());
      const f = field(key, options.length > 1 ? options : undefined);
      if (key === 'motor' && ['Swing', 'Sliding'].includes(name))
        f.key = 'operation';
      const index = fields.findIndex((existing) => existing.key === f.key);
      if (index >= 0) fields[index] = f;
      else fields.push(f);
    } else if (/^(Manual|Motorized)/.test(part)) {
      fields[0] = field(
        'operation',
        part === 'Motorized only'
          ? ['Motorized']
          : part.split('|').map((s) => s.trim())
      );
    } else if (part === 'Number of panels') fields.push(field('panels'));
    else if (part.includes('|') && !part.startsWith('Extras:'))
      fields.push(
        field(
          part.startsWith('Framed')
            ? 'framing'
            : part.startsWith('With door')
              ? 'door'
              : part.startsWith('Attached to wall')
                ? 'mounting'
                : 'opening',
          part.split('|').map((s) => s.trim())
        )
      );
  }
  return fields;
}
