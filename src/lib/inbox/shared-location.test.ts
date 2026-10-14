import { expect, it } from 'vitest';
import { sharedLocation } from './shared-location';
it('preserves the inbound map pin and optional customer label', () => {
  expect(
    sharedLocation('Office — Doha\nhttps://www.google.com/maps?q=25.3,51.5')
  ).toEqual({
    url: 'https://www.google.com/maps?q=25.3,51.5',
    label: 'Office — Doha',
  });
  expect(
    sharedLocation('https://www.google.com/maps?q=-25,-51')?.label
  ).toBeNull();
});
it.each([
  null,
  '',
  'javascript:alert(1)',
  'https://www.google.com.evil.test/maps?q=25,51',
  'https://www.google.com/maps?q=91,51',
  'https://www.google.com/maps?q=25,181',
  'https://www.google.com/maps?q=NaN,51',
  'https://www.google.com/maps?q=,',
  'https://www.google.com/maps?q=Doha',
])(
  'does not turn an invalid or untrusted value into a map link: %s',
  (text) => {
    expect(sharedLocation(text)).toBeNull();
  }
);
