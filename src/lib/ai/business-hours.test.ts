import { describe, it, expect } from 'vitest'
import { isWithinBusinessHours } from './business-hours'

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
