import { describe, it, expect } from 'vitest'
import { isWithinBusinessHours, normalizeTimezone, formatBusinessHours } from './business-hours'

describe('isWithinBusinessHours', () => {
  it('is always open when unconfigured (null)', () => {
    expect(isWithinBusinessHours(null, 'UTC', new Date('2026-07-27T02:00:00Z'))).toBe(true)
  })

  it('is always open when the map is empty', () => {
    expect(isWithinBusinessHours({}, 'UTC', new Date('2026-07-27T02:00:00Z'))).toBe(true)
  })

  it('is open within the configured window (UTC)', () => {
    // 2026-07-27 is a Monday.
    const hours = { mon: ['09:00', '18:00'] as [string, string] }
    expect(isWithinBusinessHours(hours, 'UTC', new Date('2026-07-27T12:00:00Z'))).toBe(true)
  })

  it('is closed outside the configured window (UTC)', () => {
    const hours = { mon: ['09:00', '18:00'] as [string, string] }
    expect(isWithinBusinessHours(hours, 'UTC', new Date('2026-07-27T20:00:00Z'))).toBe(false)
  })

  it('treats a day with a null value as explicitly closed', () => {
    const hours = { mon: null }
    expect(isWithinBusinessHours(hours, 'UTC', new Date('2026-07-27T12:00:00Z'))).toBe(false)
  })

  it('treats an unconfigured weekday as open', () => {
    const hours = { tue: ['09:00', '18:00'] as [string, string] }
    // Monday isn't in the map at all.
    expect(isWithinBusinessHours(hours, 'UTC', new Date('2026-07-27T12:00:00Z'))).toBe(true)
  })

  it('handles an over-midnight range', () => {
    const hours = { mon: ['22:00', '02:00'] as [string, string] }
    expect(isWithinBusinessHours(hours, 'UTC', new Date('2026-07-27T23:00:00Z'))).toBe(true)
    expect(isWithinBusinessHours(hours, 'UTC', new Date('2026-07-27T12:00:00Z'))).toBe(false)
  })

  it('evaluates in the account timezone, not UTC', () => {
    // 09:00 in Asia/Qatar (UTC+3) is 06:00 UTC. A UTC evaluation at
    // 07:00 UTC would say "before 09:00, closed" -- but in Qatar it's
    // already 10:00, well inside a 09:00-18:00 window.
    const hours = { mon: ['09:00', '18:00'] as [string, string] }
    expect(
      isWithinBusinessHours(hours, 'Asia/Qatar', new Date('2026-07-27T07:00:00Z')),
    ).toBe(true)
  })

  it('fails open on an invalid timezone rather than blocking a reply', () => {
    const hours = { mon: ['09:00', '18:00'] as [string, string] }
    expect(
      isWithinBusinessHours(hours, 'Not/ATimezone', new Date('2026-07-27T23:00:00Z')),
    ).toBe(true)
  })
})

describe('normalizeTimezone', () => {
  it('maps UTC/GMT whole-hour offsets to Etc/GMT zones (sign inverted)', () => {
    expect(normalizeTimezone('UTC+3')).toBe('Etc/GMT-3')
    expect(normalizeTimezone('GMT+03:00')).toBe('Etc/GMT-3')
    expect(normalizeTimezone('UTC-5')).toBe('Etc/GMT+5')
  })

  it('keeps a half-hour offset as an ISO offset', () => {
    expect(normalizeTimezone('UTC+5:30')).toBe('+05:30')
  })

  it('passes IANA names through unchanged', () => {
    expect(normalizeTimezone('Asia/Qatar')).toBe('Asia/Qatar')
    expect(normalizeTimezone('UTC')).toBe('UTC')
  })
})

describe('isWithinBusinessHours — offset-style timezone', () => {
  // The live account stores "UTC+3". Intl rejects it, and the old code
  // failed open -- every hour counted as business hours.
  const hours = { tue: ['09:00', '17:00'] as [string, string] }

  it('is closed at 21:00 Qatar time with timezone "UTC+3"', () => {
    // 2026-09-22 18:00Z = Tuesday 21:00 in Qatar.
    expect(isWithinBusinessHours(hours, 'UTC+3', new Date('2026-09-22T18:00:00Z'))).toBe(false)
  })

  it('is open at 10:00 Qatar time with timezone "UTC+3"', () => {
    expect(isWithinBusinessHours(hours, 'UTC+3', new Date('2026-09-22T07:00:00Z'))).toBe(true)
  })
})

describe('formatBusinessHours', () => {
  it('lists configured days Sunday-first and marks closed days', () => {
    expect(
      formatBusinessHours({
        sun: ['09:00', '17:00'],
        thu: ['09:00', '14:00'],
        fri: null,
      }),
    ).toBe('Sunday 09:00-17:00; Thursday 09:00-14:00; Friday closed')
  })

  it('is null when hours are not configured', () => {
    expect(formatBusinessHours(null)).toBeNull()
    expect(formatBusinessHours({})).toBeNull()
  })
})
