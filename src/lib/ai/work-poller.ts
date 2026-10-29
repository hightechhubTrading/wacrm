import { supabaseAdmin } from './admin-client';
import { remindDueFollowups } from './followup-reminders';
import { recoverStaleMediaActions } from './media-action-recovery';
const KEY = Symbol.for('wacrm.ai-work-poller');
/** Staff notifications only; no outbound customer sends or ownership changes. */
export function startAiWorkPoller(intervalMs = 60000) {
  if (process.env.AI_WORK_POLL_ENABLED !== 'true') return;
  const g = globalThis as typeof globalThis & {
    [KEY]?: ReturnType<typeof setInterval>;
  };
  if (g[KEY]) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const db = supabaseAdmin();
      await remindDueFollowups(db);
      await recoverStaleMediaActions(db);
    } catch {
      console.warn('[ai work] maintenance unavailable');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), Math.max(intervalMs, 10000));
  timer.unref?.();
  g[KEY] = timer;
}
