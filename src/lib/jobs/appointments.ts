import { businessDateTimeToIso } from '@/lib/business-time';

export interface Appointment {
  id: string;
  starts_at: string;
  ends_at: string;
  status: 'reserved' | 'completed' | 'cancelled';
  kind?: 'visit' | 'installation';
  handoff_id?: string;
  deal_id?: string;
  responsible_profile_id?: string | null;
  responsible_name?: string;
  revision?: number;
  work?: {
    reference: number;
    kind: 'measurement' | 'workshop';
    status: string;
    location: string;
    deal: { title: string } | null;
  } | null;
}
export interface JobPerson {
  id: string;
  full_name: string | null;
  user_id: string;
}
export interface BookingSelection {
  starts_at: string;
  ends_at: string;
  available: boolean;
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function bookingInput(body: Record<string, unknown>, now = Date.now()) {
  const start = body.starts_at,
    end = body.ends_at,
    person = body.responsible_profile_id;
  if (
    typeof start !== 'string' ||
    typeof end !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(start) ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(end)
  )
    return null;
  const a = Date.parse(start),
    b = Date.parse(end);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a <= now ||
    b - a < 15 * 60_000 ||
    b - a > 24 * 60 * 60_000 ||
    (person !== undefined && (typeof person !== 'string' || !UUID.test(person)))
  )
    return null;
  return {
    starts_at: new Date(a).toISOString(),
    ends_at: new Date(b).toISOString(),
    responsible_profile_id: person as string | undefined,
  };
}
export function overlaps(
  start: string,
  end: string,
  busy: Pick<Appointment, 'starts_at' | 'ends_at' | 'status'>
) {
  return (
    busy.status === 'reserved' &&
    Date.parse(start) < Date.parse(busy.ends_at) &&
    Date.parse(end) > Date.parse(busy.starts_at)
  );
}
export function shiftDay(day: string, offset: number) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function dayInstant(day: string) {
  return businessDateTimeToIso(day + 'T00:00');
}
export function calendarRange(from: string | null, to: string | null) {
  if (!from || !to || !/Z$/i.test(from) || !/Z$/i.test(to)) return null;
  const start = Date.parse(from),
    end = Date.parse(to);
  return Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    end - start <= 8 * 86400_000
    ? { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
    : null;
}
