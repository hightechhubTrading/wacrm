import type { SupabaseClient } from '@supabase/supabase-js';
/** Durable database fanout; device transport remains in the mobile push queue. */
export async function drainNotificationEvents(
  db: SupabaseClient
): Promise<number> {
  const { data, error } = await db.rpc('maintain_notifications');
  if (error) throw new Error('Notification delivery unavailable');
  return typeof data === 'number' ? data : 0;
}
