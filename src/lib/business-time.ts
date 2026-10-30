/** Shared operational calendar; explicitly selected for HTH by the user. */
export const BUSINESS_TIME_ZONE = 'Asia/Qatar';
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function parts(date: Date) {
  return Object.fromEntries(
    partsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}
export function businessDateTimeValue(date: Date | string) {
  const p = parts(new Date(date));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Convert an explicitly Qatar wall-clock input to an absolute instant. */
export function businessDateTimeToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year < 100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    const represented = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second)
    );
    instant = wall - (represented - instant);
  }
  const date = new Date(instant);
  return businessDateTimeValue(date) === value ? date.toISOString() : null;
}
export function businessDayBoundary(now = new Date(), offset = 0) {
  const p = parts(now);
  const calendar = new Date(
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + offset)
  );
  const date = calendar.toISOString().slice(0, 10);
  return new Date(businessDateTimeToIso(`${date}T00:00`)!);
}
export function businessDayEnd(now = new Date()) {
  return new Date(businessDayBoundary(now, 1).getTime() - 1);
}
export function businessMondayIndex(now = new Date()) {
  const p = parts(now);
  return (
    (new Date(
      Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))
    ).getUTCDay() +
      6) %
    7
  );
}
export const businessDayKey = (value: Date | string) =>
  businessDateTimeValue(value).slice(0, 10);
const formatters = new Map<string, Intl.DateTimeFormat>();
export function formatBusinessDate(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  }
) {
  const key = JSON.stringify([locale, options]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: BUSINESS_TIME_ZONE,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(new Date(value));
}
