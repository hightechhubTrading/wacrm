import { supabaseAdmin } from '@/lib/ai/admin-client';
import { drainNotificationEvents } from './delivery';
import { drainMobilePush } from '@/lib/mobile/push/worker';
const key = Symbol.for('wacrm.notification-poller');
/** Explicit runtime opt-in: builds and deployment candidates never start this worker. */
export function startNotificationPoller(interval = 15000) {
  if (process.env.NOTIFICATION_WORK_POLL_ENABLED !== 'true') return;
  const state = globalThis as typeof globalThis & {
    [key]?: ReturnType<typeof setInterval>;
  };
  if (state[key]) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const db = supabaseAdmin();
      await drainNotificationEvents(db);
      await drainMobilePush(db);
    } catch {
      console.warn('[notifications] worker unavailable');
    } finally {
      busy = false;
    }
  };
  state[key] = setInterval(() => void tick(), Math.max(5000, interval));
  state[key].unref?.();
  void tick();
}
