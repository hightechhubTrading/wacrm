import { describe, expect, it } from 'vitest';
import { convertDimensions, nextItemCode } from './item-editor';
import type { QuotationItemToSave } from './crud';
const item: QuotationItemToSave = {
  id: 'door',
  itemType: 'line',
  description: 'Steel door',
  sizeW: 4,
  sizeH: 5,
  measurementUnit: 'm',
};
describe('HTH quotation item editing', () => {
  it('preserves the opening size when changing units', () => {
    expect(convertDimensions(item, 'mm')).toEqual({
      sizeW: 4000,
      sizeH: 5000,
      measurementUnit: 'mm',
    });
    expect(
      convertDimensions({ ...item, ...convertDimensions(item, 'mm') }, 'm')
    ).toEqual({ sizeW: 4, sizeH: 5, measurementUnit: 'm' });
  });
  it('converts partial dimensions without inventing the missing measurement', () => {
    expect(convertDimensions({ ...item, sizeH: undefined }, 'cm')).toEqual({
      sizeW: 400,
      sizeH: undefined,
      measurementUnit: 'cm',
    });
  });
  it('allocates product and accessory references independently without collisions', () => {
    expect(
      nextItemCode(
        [
          { ...item, itemCode: 'D01' },
          { ...item, id: 'other', itemCode: 'D02' },
          { ...item, id: 'motor', itemCode: 'A01' },
        ],
        'D'
      )
    ).toBe('D03');
    expect(nextItemCode([{ ...item, itemCode: 'D01' }], 'A')).toBe('A01');
    expect(nextItemCode([{ ...item, itemCode: 'D1' }], 'D')).toBe('D02');
  });
});
