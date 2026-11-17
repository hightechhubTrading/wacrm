import { useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { db } from './client';

/** Events invalidate reads; never render database event payloads as authorized data. */
export function useLiveUpdates(
  enabled: boolean,
  accountId: string | null,
  conversationId: string | null,
  invalidate: () => void
) {
  const latest = useRef(invalidate);
  useEffect(() => {
    latest.current = invalidate;
  }, [invalidate]);
  const [connection, setConnection] = useState('Connecting to live updates…');
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof db.channel> | null = null;
    let generation = 0,
      foreground = document.visibilityState !== 'hidden';
    function schedule() {
      if (disposed || !foreground || !navigator.onLine || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed) latest.current();
      }, 350);
    }
    function stop() {
      generation++;
      const old = channel;
      channel = null;
      if (old) void db.removeChannel(old);
    }
    function connect() {
      stop();
      if (!foreground) return;
      if (!navigator.onLine) {
        setConnection('Offline. Updates will resume when connected.');
        return;
      }
      setConnection('Connecting to live updates…');
      if (!accountId) {
        setConnection('Checking account access…');
        return;
      }
      const current = generation;
      channel = db
        .channel(
          `mobile:${accountId}:${conversationId ?? 'inbox'}:${crypto.randomUUID()}`
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
            filter: `account_id=eq.${accountId}`,
          },
          schedule
        );
      if (conversationId)
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          schedule
        );
      channel.subscribe((status) => {
        if (disposed || current !== generation) return;
        if (status === 'SUBSCRIBED') {
          setConnection('Live updates connected');
          schedule();
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setConnection(
            'Live updates reconnecting. Checking for changes every 30 seconds.'
          );
          schedule();
        }
      });
    }
    function resume() {
      if (disposed) return;
      foreground = true;
      connect();
      schedule();
    }
    function pause() {
      foreground = false;
      stop();
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
    function visibility() {
      if (document.visibilityState === 'hidden') pause();
      else resume();
    }
    function offline() {
      stop();
      setConnection('Offline. Updates will resume when connected.');
      latest.current();
    }
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    const native = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', (s) => {
          if (s.isActive) resume();
          else pause();
        })
      : null;
    // DELETE/reassignment events may be unavailable after RLS changes; bounded refetch is required even when connected.
    const poll = setInterval(schedule, 30000);
    connect();
    return () => {
      disposed = true;
      stop();
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      void native?.then((h) => h.remove());
    };
  }, [enabled, accountId, conversationId]);
  return connection;
}
