import { describe, expect, it } from 'vitest';
import {
  bookingInput,
  calendarRange,
  dayInstant,
  overlaps,
  shiftDay,
} from './appointments';
const start = '2027-01-02T07:00:00Z',
  end = '2027-01-02T08:00:00Z';
const now = Date.parse('2027-01-01T00:00:00Z');
describe('company calendar inputs and capacity', () => {
  it('accepts explicit instants and permits the server to default the requester', () => {
    expect(bookingInput({ starts_at: start, ends_at: end }, now)).toEqual({
      starts_at: '2027-01-02T07:00:00.000Z',
      ends_at: '2027-01-02T08:00:00.000Z',
      responsible_profile_id: undefined,
    });
  });
  it.each([
    { starts_at: '2027-01-02T10:00', ends_at: end },
    { starts_at: start, ends_at: start },
    { starts_at: end, ends_at: start },
    { starts_at: start, ends_at: '2027-01-02T07:10:00Z' },
    { starts_at: start, ends_at: '2027-01-04T08:00:00Z' },
    { starts_at: '2020-01-01T00:00:00Z', ends_at: end },
    {
      starts_at: start,
      ends_at: end,
      responsible_profile_id: 'free text name',
    },
  ])('rejects invalid booking %j', (body) =>
    expect(bookingInput(body, now)).toBeNull()
  );
  it('blocks any intersecting reserved time but permits adjacent appointments', () => {
    const busy = {
      starts_at: start,
      ends_at: end,
      status: 'reserved' as const,
    };
    expect(overlaps('2027-01-02T07:30:00Z', '2027-01-02T08:30:00Z', busy)).toBe(
      true
    );
    expect(overlaps('2027-01-02T06:00:00Z', start, busy)).toBe(false);
    expect(overlaps(end, '2027-01-02T09:00:00Z', busy)).toBe(false);
    expect(overlaps(start, end, { ...busy, status: 'cancelled' })).toBe(false);
    expect(overlaps(start, end, { ...busy, status: 'completed' })).toBe(false);
  });
  it('uses Qatar midnight across year boundaries and caps read ranges', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayInstant('2027-01-01')).toBe('2026-12-31T21:00:00.000Z');
    expect(calendarRange(start, end)).not.toBeNull();
    expect(calendarRange(null, end)).toBeNull();
    expect(calendarRange(end, start)).toBeNull();
    expect(calendarRange(start, '2027-02-01T00:00:00Z')).toBeNull();
  });
});
