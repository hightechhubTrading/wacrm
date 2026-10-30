/** One coordinator per mounted account. Realtime stays live in hidden tabs. */
export function createCallingSync(options: {
  loadSettings: () => Promise<boolean>;
  loadCalls: () => Promise<void>;
  hasActiveCall: () => boolean;
}) {
  let disposed = false;
  let healthy = false;
  let enabled: boolean | null = null;
  let timer: ReturnType<typeof setTimeout>;
  let settingsTimer: ReturnType<typeof setInterval>;
  let running: Promise<void> | undefined;
  let settingsRunning: Promise<void> | undefined;
  let queued = false;

  const schedule = () => {
    clearTimeout(timer);
    if (disposed) return;
    timer = setTimeout(
      () => void refresh(),
      healthy && !options.hasActiveCall() ? 30_000 : 4_000
    );
  };

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (running) {
      queued = true;
      return running;
    }
    if (enabled === false && !options.hasActiveCall()) {
      schedule();
      return Promise.resolve();
    }
    running = (async () => {
      try {
        do {
          queued = false;
          await options.loadCalls();
        } while (queued && !disposed);
      } catch {
        // A transient failure must not end audio or lose the next fallback poll.
      } finally {
        running = undefined;
        schedule();
      }
    })();
    return running;
  };

  const refreshSettings = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (settingsRunning) return settingsRunning;
    settingsRunning = (async () => {
      try {
        const next = await options.loadSettings();
        if (disposed) return;
        const previous = enabled;
        enabled = next;
        if (next && previous !== true) void refresh();
      } catch {
        // Keep the last known setting. A network error is not an opt-out.
      } finally {
        settingsRunning = undefined;
      }
    })();
    return settingsRunning;
  };

  return {
    start() {
      void refreshSettings();
      // Initial reconciliation also discovers an active call after a reload.
      void refresh();
      settingsTimer = setInterval(() => void refreshSettings(), 30_000);
    },
    refresh,
    refreshSettings,
    setRealtimeHealthy(next: boolean) {
      if (disposed || next === healthy) return;
      healthy = next;
      void refresh();
      schedule();
    },
    stop() {
      disposed = true;
      queued = false;
      clearTimeout(timer);
      clearInterval(settingsTimer);
    },
  };
}
