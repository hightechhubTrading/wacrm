import { expect, it } from 'vitest';
import { quietNow, targetHref } from './policy';
it('handles overnight quiet hours in the saved timezone', () => {
  const quiet = {
    quiet_start: 22 * 60,
    quiet_end: 7 * 60,
    timezone: 'Asia/Qatar',
  };
  expect(quietNow(quiet, new Date('2026-11-22T20:00:00Z'))).toBe(true);
  expect(quietNow(quiet, new Date('2026-11-22T06:00:00Z'))).toBe(false);
  expect(quietNow({ ...quiet, quiet_start: 0, quiet_end: 0 })).toBe(false);
});
it('handles daylight-saving timezone transitions', () => {
  const quiet = { quiet_start: 60, quiet_end: 180, timezone: 'Europe/Berlin' };
  expect(quietNow(quiet, new Date('2026-10-25T00:30:00Z'))).toBe(true);
  expect(quietNow(quiet, new Date('2026-10-25T01:30:00Z'))).toBe(true);
  expect(quietNow(quiet, new Date('2026-10-25T03:00:00Z'))).toBe(false);
});
it('routes standalone business notices to their source without requiring a conversation', () => {
  expect(
    targetHref({
      type: 'quotation_followup_due',
      target_kind: 'quotation',
      target_id: 'q',
    })
  ).toBe('/quotations/q');
  expect(
    targetHref({
      type: 'appointment_due',
      target_kind: 'appointment',
      target_id: 'a',
    })
  ).toBe('/calendar');
  expect(targetHref({ type: 'ai_key_invalid' })).toBe('/agents?tab=setup');
  expect(targetHref({ type: 'unknown' })).toBeNull();
});
