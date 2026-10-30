/** Local, bounded diagnostic counters. No message text, identifiers or error payloads. */
const events = [
  'send.accepted',
  'send.rejected',
  'send.unknown',
  'reconcile.accepted',
  'reconcile.rejected',
  'reconcile.unknown',
  'queue.ready',
  'queue.failed',
  'quotation.saved',
  'quotation.rejected',
  'quotation.unavailable',
  'route.failed',
] as const;
export type ReliabilityEvent = (typeof events)[number];
const allowed = new Set<string>(events);
const counts = new Map<ReliabilityEvent, number>();
type Timing = { samples: number; totalMs: number; maxMs: number };
const timings = new Map<ReliabilityEvent, Timing>();
export function recordReliability(
  event: ReliabilityEvent,
  durationMs?: number
) {
  if (!allowed.has(event)) return;
  counts.set(event, Math.min(1_000_000, (counts.get(event) ?? 0) + 1));
  if (durationMs != null && Number.isFinite(durationMs) && durationMs >= 0) {
    const previous = timings.get(event) ?? { samples: 0, totalMs: 0, maxMs: 0 };
    if (previous.samples >= 1_000_000) return;
    const ms = Math.min(300_000, Math.round(durationMs));
    timings.set(event, {
      samples: previous.samples + 1,
      totalMs: previous.totalMs + ms,
      maxMs: Math.max(previous.maxMs, ms),
    });
  }
}
/** Explicitly requested diagnostics can inspect counts without exporting customer data. */
export function reliabilitySnapshot(): Readonly<
  Partial<Record<ReliabilityEvent, number>>
> {
  return Object.freeze(Object.fromEntries(counts));
}
export function reliabilityTimings(): Readonly<
  Partial<Record<ReliabilityEvent, Readonly<Timing>>>
> {
  return Object.freeze(
    Object.fromEntries(
      [...timings].map(([event, timing]) => [
        event,
        Object.freeze({ ...timing }),
      ])
    )
  );
}
