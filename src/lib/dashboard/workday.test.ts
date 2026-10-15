import { describe, expect, it } from 'vitest';
import { getWorkdayCountdown } from './workday';

describe('workday countdown', () => {
  it('counts down in the account timezone and calculates the sand level', () => {
    const result = getWorkdayCountdown(
      { wed: ['09:00', '18:00'] },
      'UTC+3',
      new Date('2026-10-14T12:00:00Z')
    );
    expect(result.state).toBe('working');
    expect(result.remaining).toBe(10800);
    expect(result.progress).toBeCloseTo(2 / 3);
    expect(result.closesAt?.toISOString()).toBe('2026-10-14T15:00:00.000Z');
  });

  it('finishes exactly at closing time', () => {
    expect(
      getWorkdayCountdown(
        { wed: ['09:00', '18:00'] },
        'Asia/Qatar',
        new Date('2026-10-14T15:00:00Z')
      )
    ).toMatchObject({ state: 'finished', remaining: 0, progress: 1 });
  });

  it('keeps the sand full before opening', () => {
    expect(
      getWorkdayCountdown(
        { wed: ['09:00', '18:00'] },
        'Asia/Qatar',
        new Date('2026-10-14T05:00:00Z')
      )
    ).toMatchObject({ state: 'upcoming', remaining: 36000, progress: 0 });
  });

  it('continues an overnight shift from the previous day', () => {
    const result = getWorkdayCountdown(
      { wed: ['22:00', '02:00'], thu: null },
      'Asia/Qatar',
      new Date('2026-10-14T22:00:00Z')
    );
    expect(result).toMatchObject({
      state: 'working',
      remaining: 3600,
      progress: 0.75,
    });
  });

  it('accounts for a daylight-saving transition during a shift', () => {
    const result = getWorkdayCountdown(
      { sun: ['00:00', '08:00'] },
      'Europe/Berlin',
      new Date('2026-03-29T00:00:00Z')
    );
    expect(result.remaining).toBe(21600);
    expect(result.progress).toBeCloseTo(1 / 7);
  });

  it('does not invent hours for unconfigured or closed days', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(getWorkdayCountdown(null, 'UTC', now).state).toBe('unconfigured');
    expect(getWorkdayCountdown({ wed: null }, 'UTC', now).state).toBe('off');
    expect(
      getWorkdayCountdown({ fri: ['09:00', '18:00'] }, 'UTC', now).state
    ).toBe('off');
  });

  it('flags malformed hours and invalid timezones', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(
      getWorkdayCountdown({ wed: ['25:00', '18:00'] }, 'UTC', now).state
    ).toBe('invalid');
    expect(
      getWorkdayCountdown({ wed: ['09:00', '18:00'] }, 'Invalid/Zone', now)
        .state
    ).toBe('invalid');
  });
});
