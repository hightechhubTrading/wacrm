'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { createReconciler } from '@/lib/notifications/reconcile';

export function useUnreadNotifications(): number {
  const { accountId, user, accountRole } = useAuth();
  const scope = `${accountId}:${user?.id}:${accountRole}`;
  const [state, setState] = useState({ scope: '', count: 0 });
  useEffect(() => {
    if (!accountId || !user?.id) return;
    const db = createClient();
    const sync = createReconciler(
      async () => {
        const { count, error } = await db
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('user_id', user.id)
          .is('read_at', null);
        if (error) throw error;
        return count ?? 0;
      },
      (count) => setState({ scope, count })
    );
    sync.refresh();
    const channel = db
      // Supabase reuses channels by topic. Each mounted badge/page reader
      // needs its own lifecycle, including Strict Mode effect restarts.
      .channel(`notification-count:${scope}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        sync.invalidate
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') sync.refresh();
      });
    const resume = () => {
      if (document.visibilityState === 'visible') sync.refresh();
    };
    window.addEventListener('focus', resume);
    window.addEventListener('notifications-changed', sync.refresh);
    document.addEventListener('visibilitychange', resume);
    const timer = setInterval(resume, 60_000);
    return () => {
      sync.stop();
      clearInterval(timer);
      void db.removeChannel(channel);
      window.removeEventListener('focus', resume);
      window.removeEventListener('notifications-changed', sync.refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [accountId, user?.id, scope]);
  return state.scope === scope ? state.count : 0;
}
