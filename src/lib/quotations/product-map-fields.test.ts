import { describe, expect, it } from 'vitest';
import { productMapFields } from './product-map-fields';
describe('owner-directed product questions', () => {
  it('asks standard questions and exact 41/55 colours without extending them to 77', () => {
    const spec =
      'Configuration choices: Manual crank | Motor with remote; Box: Angled | Square; Window: Rectangular | Arched; Extras: Extra remote | Group control.';
    const fields = productMapFields('Window Shutter 41', spec)!;
    expect(fields.slice(0, 3).map((f) => f.key)).toEqual([
      'operation',
      'finish',
      'usedFor',
    ]);
    expect(fields.find((f) => f.key === 'finish')?.options).toEqual([
      'Beige',
      'White',
    ]);
    expect(
      productMapFields('Window Shutter 77', spec)?.find(
        (f) => f.key === 'finish'
      )?.options
    ).toBeUndefined();
    expect(fields.find((f) => f.key === 'box')?.options).toEqual([
      'Angled',
      'Square',
    ]);
    expect(fields.some((f) => f.key === 'extras')).toBe(false);
  });
  it('keeps independent partition frame and door questions', () => {
    const fields = productMapFields(
      'Glass Partition',
      'Configuration choices: Framed | Frameless; With door | Without door.'
    )!;
    expect(fields.map((f) => f.key)).toEqual([
      'operation',
      'finish',
      'usedFor',
      'framing',
      'door',
    ]);
  });
  it('does not turn old source prose into selectable options', () => {
    expect(
      productMapFields('Window Shutter 41', 'Historical offer: White or red.')
    ).toBeNull();
  });
  it('keeps motorized-only sectional operation and certificate rating choice', () => {
    expect(
      productMapFields(
        'Sectional Garage Door (American)',
        'Configuration choices: Motorized only; Motor position: Ceiling centre | Side.'
      )?.[0].options
    ).toEqual(['Motorized']);
    expect(
      productMapFields(
        'Fire-rated Door',
        'Configuration choices: Rating: 60 | 90 | 120 | 180 minutes, with certificate for the selected system.'
      )?.find((f) => f.key === 'rating')?.options
    ).toEqual(['60', '90', '120', '180 minutes']);
  });
});
