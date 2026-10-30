import { expect, it } from 'vitest';
import {
  businessDateTimeToIso,
  businessDateTimeValue,
  businessDayBoundary,
  businessDayEnd,
  businessMondayIndex,
} from './business-time';
it('uses Qatar calendar days across UTC, European DST and year boundaries', () => {
  expect(
    businessDayBoundary(new Date('2026-10-30T22:30:00Z')).toISOString()
  ).toBe('2026-10-30T21:00:00.000Z');
  expect(
    businessDayBoundary(new Date('2026-10-30T20:59:59Z'), 1).toISOString()
  ).toBe('2026-10-30T21:00:00.000Z');
  expect(businessDayEnd(new Date('2026-10-25T09:00:00Z')).toISOString()).toBe(
    '2026-10-25T20:59:59.999Z'
  );
  expect(
    businessDayBoundary(new Date('2026-12-31T22:00:00Z'), 1).toISOString()
  ).toBe('2027-01-01T21:00:00.000Z');
  expect(businessMondayIndex(new Date('2026-10-25T21:01:00Z'))).toBe(0);
});
it('converts deadline inputs independently of the device timezone and rejects invalid wall times', () => {
  expect(businessDateTimeToIso('2026-10-25T09:00')).toBe(
    '2026-10-25T06:00:00.000Z'
  );
  expect(businessDateTimeValue('2026-10-25T06:00:00Z')).toBe(
    '2026-10-25T09:00'
  );
  for (const invalid of [
    '2026-02-30T09:00',
    '2026-13-01T09:00',
    '2026-10-30T25:00',
    'not-a-date',
  ])
    expect(businessDateTimeToIso(invalid)).toBeNull();
});
