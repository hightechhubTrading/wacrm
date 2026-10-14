import { expect, it } from 'vitest';
import { priceOutsideRange } from './price';
import type { ProductPromptItem } from '../media-library';

const product: ProductPromptItem = {
  id: 'shutter',
  name: 'Shutter',
  description: '',
  tagId: null,
  priceMin: 350,
  priceMax: 380,
  priceUnit: 'per_meter',
  priceNotes: null,
  files: [],
};
it.each([
  'QAR 350–380 per metre',
  'من ٣٥٠ إلى ٣٨٠ ريال قطري للمتر',
  '350 to 380 QAR',
  'Opening 3m × 2m',
])('accepts base range/measurements: %s', (text) => {
  expect(priceOutsideRange(text, product)).toBe(false);
});
it.each([
  'QAR 150 per metre',
  '١٥٠ ريال قطري',
  'From QAR 350 to 900',
  'USD 1,500',
])('rejects an out-of-range base figure: %s', (text) => {
  expect(priceOutsideRange(text, product)).toBe(true);
});
it('leaves add-on notes for the semantic check instead of treating an add-on as a base quote', () => {
  expect(
    priceOutsideRange('Motor add-on QAR 50', {
      ...product,
      priceNotes: 'Motor add-on QAR 50',
    })
  ).toBe(false);
});
