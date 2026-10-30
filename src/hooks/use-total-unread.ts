'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { createUnreadCounter } from '@/lib/inbox/unread-counter';

/** Numeric conversation badge with bounded payloads and reconnect recovery. */
export function useTotalUnread(): number {
  const { accountId, user, accountRole } = useAuth();
  const scope = `${accountId}:${user?.id}:${accountRole}`;
  const [state, setState] = useState({ scope: '', count: 0 });
  useEffect(() => {
    if (!accountId || !user?.id) return;
    const db = createClient();
    const counter = createUnreadCounter(
      async () => {
        const { count, error } = await db
          .from('conversations')
          .select('id', { head: true, count: 'exact' })
          .eq('account_id', accountId)
          .gt('unread_count', 0);
        if (error) throw error;
        return count ?? 0;
      },
      (count) => setState({ scope, count })
    );
    void counter.refresh();
    const channel = db
      .channel(`total-unread:${scope}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `account_id=eq.${accountId}`,
        },
        counter.event
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void counter.refresh();
      });
    const resume = () => {
      if (document.visibilityState === 'visible') void counter.refresh();
    };
    // Assignment/access changes may remove visibility without a row event.
    const timer = setInterval(resume, 60_000);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      counter.stop();
      clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      void db.removeChannel(channel);
    };
  }, [accountId, user?.id, scope]);
  return state.scope === scope ? state.count : 0;
}
