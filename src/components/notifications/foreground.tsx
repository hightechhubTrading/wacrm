'use client';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';
import { toast } from 'sonner';
import { quietNow, targetHref } from '@/lib/notifications/policy';
/** Only the focused tab may interrupt; Web Locks serialize duplicate realtime delivery. */
export function NotificationForeground() {
  const { accountId, user, accountRole } = useAuth();
  const t = useTranslations('NotificationCenter');
  useEffect(() => {
    if (!accountId || !user?.id || accountRole === 'viewer') return;
    const db = createClient();
    let stopped = false;
    let settings: {
      foreground: boolean;
      categories: string[];
      sound: boolean;
      supervise: boolean;
      quiet: Parameters<typeof quietNow>[0];
    } | null = null;
    const started = Date.now();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const load = async () => {
      try {
        const response = await fetch('/api/notifications/settings', {
          cache: 'no-store',
        });
        if (response.ok && !stopped) settings = await response.json();
      } catch {
        /* Center remains available if interruption policy cannot be loaded. */
      }
    };
    void load();
    window.addEventListener('notification-preferences-changed', load);
    const play = () => {
      if (!settings?.sound) return;
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        gain.gain.value = 0.025;
        oscillator.frequency.value = 660;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
        oscillator.onended = () => void context.close();
      } catch {
        /* Sound is optional and follows browser autoplay policy. */
      }
    };
    const show = async (
      id: string,
      notice?: Notification,
      conversationId?: string
    ) => {
      if (
        stopped ||
        !settings?.foreground ||
        !settings.categories.includes(notice?.category ?? 'assignments') ||
        quietNow(settings.quiet) ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        !navigator.locks
      )
        return;
      const conversation = notice?.conversation_id ?? conversationId;
      if (
        notice?.priority !== 'high' &&
        location.pathname === '/inbox' &&
        new URLSearchParams(location.search).get('c') === conversation
      )
        return;
      await navigator.locks.request(
        `crm-notifications:${accountId}:${user.id}`,
        { ifAvailable: true },
        (lock) => {
          if (!lock || stopped || !document.hasFocus()) return;
          const key = `crm-notification:${accountId}:${user.id}`;
          try {
            const previous = JSON.parse(localStorage.getItem(key) || '{}');
            if (previous.id === id) return;
            localStorage.setItem(key, JSON.stringify({ id, at: Date.now() }));
          } catch {
            return;
          }
          const href = notice
            ? targetHref(notice)
            : `/inbox?c=${encodeURIComponent(conversation!)}`;
          const title =
            notice?.copy_key && t.has(`eventTitles.${notice.copy_key}`)
              ? t(`eventTitles.${notice.copy_key}`)
              : (notice?.title ?? t('newMessages'));
          toast(title, {
            id: conversation ?? id,
            action: href
              ? { label: t('open'), onClick: () => location.assign(href) }
              : undefined,
          });
          play();
        }
      );
    };
    const channel = db
      .channel(`notification-foreground:${accountId}:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Notification;
          if (
            row.account_id === accountId &&
            Date.parse(row.created_at) >= started - 5000
          )
            void show(row.id, row);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as {
            id: string;
            conversation_id: string;
            sender_type: string;
            created_at: string;
          };
          if (
            row.sender_type !== 'customer' ||
            Date.parse(row.created_at) < started - 5000
          )
            return;
          const group = row.conversation_id;
          clearTimeout(timers.get(group));
          timers.set(
            group,
            setTimeout(() => {
              timers.delete(group);
              void (async () => {
                const { data, error } = await db
                  .from('conversations')
                  .select('id,assigned_agent_id')
                  .eq('account_id', accountId)
                  .eq('id', group)
                  .maybeSingle();
                if (
                  !error &&
                  data &&
                  (data.assigned_agent_id === user.id ||
                    !data.assigned_agent_id ||
                    settings?.supervise)
                )
                  await show(row.id, undefined, group);
              })();
            }, 1500)
          );
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void load();
      });
    const timer = setInterval(() => void load(), 60000);
    return () => {
      stopped = true;
      clearInterval(timer);
      for (const timer of timers.values()) clearTimeout(timer);
      window.removeEventListener('notification-preferences-changed', load);
      void db.removeChannel(channel);
    };
  }, [accountId, user?.id, accountRole, t]);
  return null;
}
