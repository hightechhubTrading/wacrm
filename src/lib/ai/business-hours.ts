// ============================================================
// Business hours — pure logic only (no DB access; callers fetch
// accounts.business_hours / accounts.timezone themselves).
//
// Shape: one key per weekday, either null (closed) or an
// ["HH:mm","HH:mm"] open/close pair. Unlike the automations engine's
// per-step `time_of_day` condition (src/lib/automations/engine.ts),
// this evaluates in the ACCOUNT'S timezone, not the server's — a
// business's "9am-6pm" must mean 9am-6pm where the business is, not
// wherever the app happens to be deployed.
// ============================================================

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type BusinessHours = Partial<Record<Weekday, [string, string] | null>>

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function minutesSinceMidnight(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * True when `now` falls within the account's configured business
 * hours, evaluated in `timezone` (an IANA zone name). `businessHours`
 * being null/empty means "unconfigured" — treated as always open, so
 * accounts that never set this up see no behavior change.
 */
export function isWithinBusinessHours(
  businessHours: BusinessHours | null,
  timezone: string,
  now: Date = new Date(),
): boolean {
  if (!businessHours || Object.keys(businessHours).length === 0) return true

  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
  } catch {
    // Invalid/unknown timezone -- fail open (don't block a reply over
    // a config typo) but this shouldn't happen once the Settings UI
    // validates it.
    return true
  }

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase()
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  const weekday = WEEKDAYS.find((d) => weekdayStr?.startsWith(d))
  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return true

  const range = businessHours[weekday]
  if (range === undefined) return true // day not configured -> open
  if (range === null) return false // explicitly closed that day

  const [openStr, closeStr] = range
  const open = minutesSinceMidnight(openStr)
  const close = minutesSinceMidnight(closeStr)
  if (open === null || close === null) return true // malformed -> fail open

  const nowMinutes = hour * 60 + minute
  if (open <= close) {
    return nowMinutes >= open && nowMinutes < close
  }
  // Over-midnight range (e.g. 22:00-02:00), same convention as the
  // automations engine's time_of_day condition.
  return nowMinutes >= open || nowMinutes < close
}
