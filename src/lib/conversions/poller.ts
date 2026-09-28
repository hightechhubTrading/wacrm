import { runConversionSender } from './sender'

// Single-flight: the 60 s poller and the post-tag `after()` kick share
// one in-process run. Cross-process safety comes from the SKIP LOCKED
// claim in the database, not from this.
let inFlight: Promise<unknown> | null = null

export function kickConversionSender(): Promise<unknown> {
  if (!inFlight) {
    inFlight = runConversionSender()
      .catch((err) => console.error('[capi] sender run failed:', err instanceof Error ? err.message : err))
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

const POLLER_KEY = '__ctwaConversionPoller'

/** Start the outbox poller once per process (idempotent across HMR). */
export function startConversionPoller(intervalMs = 60_000): void {
  const g = globalThis as typeof globalThis & { [POLLER_KEY]?: ReturnType<typeof setInterval> }
  if (g[POLLER_KEY]) return
  const timer = setInterval(() => void kickConversionSender(), intervalMs)
  timer.unref?.()
  g[POLLER_KEY] = timer
}
