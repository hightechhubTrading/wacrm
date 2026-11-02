import { expect, it } from 'vitest';
import { termChoices } from './term-presets';
it('deduplicates equivalent recorded terms without merging different commitments', () => {
  expect(
    termChoices([
      'Warranty: One year.',
      '1 year',
      '2 years',
      'Delivery / installation: 8-10 days.',
      '8–10 days',
      '8–10 working days after approval',
    ])
  ).toEqual([
    '1 year',
    '2 years',
    '8–10 days',
    '8–10 working days after approval',
  ]);
});
it('keeps multiline scope and custom qualifications intact', () => {
  expect(
    termChoices([
      '',
      'Civil works excluded.\nExcept separately itemized services.',
    ])
  ).toEqual(['Civil works excluded.\nExcept separately itemized services']);
});
