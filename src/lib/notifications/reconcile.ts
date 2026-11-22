/** Serialize snapshots and discard results invalidated while a request was in flight. */
export function createReconciler<T>(
  load: () => Promise<T>,
  publish: (value: T) => void,
  failure: () => void = () => {}
) {
  let stopped = false,
    running = false,
    revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    const started = revision;
    try {
      const value = await load();
      if (!stopped && started === revision) publish(value);
    } catch {
      if (!stopped && started === revision) failure();
    } finally {
      running = false;
      if (!stopped && revision !== started) void run();
    }
  };
  return {
    refresh() {
      revision++;
      clearTimeout(timer);
      void run();
    },
    invalidate() {
      revision++;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 200);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
