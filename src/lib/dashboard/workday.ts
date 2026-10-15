import {
  normalizeTimezone,
  type BusinessHours,
  type Weekday,
} from '@/lib/ai/business-hours';

type State =
  'working' | 'upcoming' | 'finished' | 'off' | 'unconfigured' | 'invalid';
export type WorkdayCountdown = {
  state: State;
  remaining: number;
  progress: number;
  closesAt?: Date;
};
const weekdays: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function clock(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

/** Wall-clock timestamps are used only as calendar values, never as real instants. */
function wallTime(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(date);
  const read = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value);
  return Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second')
  );
}

function instant(wall: number, formatter: Intl.DateTimeFormat): number {
  let result = wall;
  for (let i = 0; i < 4; i++) {
    const difference = wall - wallTime(new Date(result), formatter);
    if (difference === 0) return result;
    result += difference;
  }
  // A nonexistent local time (a DST jump) needs the schedule corrected.
  throw new Error('Invalid local closing time');
}

export function getWorkdayCountdown(
  hours: BusinessHours | null,
  timezone: string,
  now: Date
): WorkdayCountdown {
  const empty = (state: State): WorkdayCountdown => ({
    state,
    remaining: 0,
    progress: state === 'finished' ? 1 : 0,
  });
  if (!hours || Object.keys(hours).length === 0) return empty('unconfigured');
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: normalizeTimezone(timezone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const wall = wallTime(now, formatter);
    const date = new Date(wall);
    const midnight = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    );
    const today = date.getUTCDay();
    const shift = (day: number, base: number) => {
      const range = hours[weekdays[day]];
      if (!range) return null;
      const start = clock(range[0]);
      const end = clock(range[1]);
      if (start === null || end === null || start === end)
        throw new Error('Invalid hours');
      return {
        opens: instant(base + start * 60000, formatter),
        closes: instant(
          base + end * 60000 + (end < start ? 86400000 : 0),
          formatter
        ),
      };
    };
    const previous = shift((today + 6) % 7, midnight - 86400000);
    const timestamp = now.getTime();
    const activePrevious =
      previous && timestamp >= previous.opens && timestamp < previous.closes;
    const selected = activePrevious ? previous : shift(today, midnight);
    if (!selected) return empty('off');
    if (timestamp >= selected.closes) return empty('finished');
    return {
      state: timestamp < selected.opens ? 'upcoming' : 'working',
      remaining: Math.max(0, Math.ceil((selected.closes - timestamp) / 1000)),
      progress: Math.max(
        0,
        Math.min(
          1,
          (timestamp - selected.opens) / (selected.closes - selected.opens)
        )
      ),
      closesAt: new Date(selected.closes),
    };
  } catch {
    return empty('invalid');
  }
}
