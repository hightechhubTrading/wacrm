type Row = { id?: string; unread_count?: number | null };
type Event = { eventType: string; new: Row; old: Row };

/** Count snapshots avoid downloading all conversation IDs. Known realtime
 * rows adjust in O(1); unknown rows trigger a coalesced snapshot. */
export function createUnreadCounter(
  load: () => Promise<number>,
  publish: (count: number) => void
) {
  let disposed = false;
  let initialized = false;
  let total = 0;
  let version = 0;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const known = new Map<string, boolean>();
  const schedule = () => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => void refresh(false), 250);
  };
  const refresh = (resetKnown = true): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (resetKnown) known.clear();
    if (pending) return pending;
    const started = version;
    pending = Promise.resolve()
      .then(load)
      .then((count) => {
        if (disposed) return;
        if (version !== started) {
          schedule();
          return;
        }
        initialized = true;
        total = count;
        publish(total);
      })
      .catch(() => {
        // Keep the previous badge; reconnect/focus/periodic reconciliation retries.
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    refresh,
    event(event: Event) {
      if (disposed) return;
      const row = event.eventType === 'DELETE' ? event.old : event.new;
      if (!row.id) {
        version++;
        schedule();
        return;
      }
      const previous = known.get(row.id);
      const next = event.eventType !== 'DELETE' && (row.unread_count ?? 0) > 0;
      version++;
      known.delete(row.id);
      if (event.eventType !== 'DELETE') known.set(row.id, next);
      if (known.size > 500) known.delete(known.keys().next().value!);
      if (initialized && previous !== undefined) {
        total = Math.max(0, total + Number(next) - Number(previous));
        publish(total);
      } else schedule();
      if (pending) schedule();
    },
    stop() {
      disposed = true;
      clearTimeout(timer);
      known.clear();
    },
  };
}
