'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
export interface ConversationPeer {
  userId: string;
  tabId: string;
  name: string | null;
  expiresAt: number;
  composingUntil: number;
}
/** Visible-conversation activity only. Realtime invalidations read without writing. */
export function useConversationActivity(
  conversationId: string,
  enabled: boolean
) {
  const { accountId, user } = useAuth();
  const [tabId] = useState(() => crypto.randomUUID()),
    sequence = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    peers: ConversationPeer[];
    unavailable: boolean;
  }>({ scope: '', peers: [], unavailable: false });
  const [now, setNow] = useState(() => Date.now());
  const scope = `${accountId}:${user?.id}:${conversationId}`;
  useEffect(() => {
    if (!enabled || !accountId || !user?.id) return;
    let disposed = false,
      generation = 0,
      inFlight = false,
      queued: 'read' | 'write' | null = null,
      lastReported = false,
      typingUntil = 0,
      realtimeHealthy = false,
      nextWriteAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined,
      typingTimer: ReturnType<typeof setTimeout> | undefined,
      eventTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const body = (leave: boolean, composing: boolean) => ({
      conversationId,
      tabId,
      sequence: ++sequence.current,
      leave,
      composing,
    });
    const leave = () => {
      generation++;
      clearTimeout(timer);
      controller?.abort();
      void fetch('/api/inbox/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(true, false)),
        keepalive: true,
      }).catch(() => {});
    };
    async function refresh(write = true, force = true) {
      if (disposed || document.visibilityState !== 'visible') return;
      const composing = Date.now() < typingUntil;
      if (write && !force && composing === lastReported) return;
      if (inFlight) {
        if (write || queued !== 'write') queued = write ? 'write' : 'read';
        return;
      }
      inFlight = true;
      queued = null;
      clearTimeout(timer);
      if (write) lastReported = composing;
      controller = new AbortController();
      const request = controller,
        version = generation,
        started = Date.now();
      try {
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(10000),
        ]);
        const response = write
          ? await fetch('/api/inbox/activity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body(false, composing)),
              signal,
            })
          : await fetch(
              `/api/inbox/activity?conversationId=${encodeURIComponent(conversationId)}&tabId=${encodeURIComponent(tabId)}`,
              { cache: 'no-store', signal }
            );
        if (!response.ok) throw new Error('unavailable');
        const data = await response.json();
        if (disposed || request.signal.aborted || version !== generation)
          return;
        const received = Date.now(),
          server = Date.parse(data.serverNow),
          elapsed = received - started;
        if (!Number.isFinite(server) || !Array.isArray(data.peers))
          throw new Error('invalid snapshot');
        setState({
          scope,
          unavailable: false,
          peers: data.peers.map((peer: Record<string, unknown>) => ({
            userId: String(peer.userId),
            tabId: String(peer.tabId),
            name: typeof peer.name === 'string' ? peer.name : null,
            expiresAt:
              received +
              Math.min(
                45000,
                Math.max(
                  0,
                  Date.parse(String(peer.expiresAt)) - server - elapsed
                )
              ),
            composingUntil:
              received +
              Math.min(
                15000,
                Math.max(
                  0,
                  Date.parse(String(peer.composingUntil)) - server - elapsed
                )
              ),
          })),
        });
        setNow(received);
      } catch {
        if (!disposed && !request.signal.aborted && version === generation)
          setState((previous) => ({
            scope,
            peers: previous.scope === scope ? previous.peers : [],
            unavailable: true,
          }));
      } finally {
        inFlight = false;
        if (write)
          nextWriteAt =
            Date.now() +
            (Date.now() < typingUntil ? 8000 : realtimeHealthy ? 30000 : 15000);
        if (!disposed && document.visibilityState === 'visible') {
          const pending = queued as 'write' | 'read' | null;
          if (pending) {
            queued = null;
            void refresh(pending === 'write');
          } else
            timer = setTimeout(
              () => void refresh(),
              Math.max(1000, nextWriteAt - Date.now())
            );
        }
      }
    }
    const onInput = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest<HTMLElement>('.crm-composer')?.dataset
          .conversationComposer !== conversationId
      )
        return;
      typingUntil = Date.now() + 5000;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => void refresh(true, false), 5100);
      void refresh(true, false);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
      else {
        typingUntil = 0;
        leave();
        setState({ scope, peers: [], unavailable: false });
      }
    };
    const db = createClient();
    const channel = db
      .channel(`conversation-activity:${conversationId}:${tabId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_activity',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { user_id?: string; tab_id?: string };
          if (
            disposed ||
            document.visibilityState !== 'visible' ||
            (row.user_id === user.id && row.tab_id === tabId)
          )
            return;
          clearTimeout(eventTimer);
          eventTimer = setTimeout(() => void refresh(false), 150);
        }
      )
      .subscribe((status) => {
        if (disposed) return;
        realtimeHealthy = status === 'SUBSCRIBED';
        if (realtimeHealthy) void refresh(false);
        else {
          nextWriteAt = Math.min(nextWriteAt, Date.now() + 15000);
          if (
            !inFlight &&
            document.visibilityState === 'visible' &&
            nextWriteAt > 0
          ) {
            clearTimeout(timer);
            timer = setTimeout(
              () => void refresh(),
              Math.max(1000, nextWriteAt - Date.now())
            );
          }
        }
      });
    void refresh();
    const expiry = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 2000);
    document.addEventListener('input', onInput, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    return () => {
      disposed = true;
      leave();
      clearTimeout(typingTimer);
      clearTimeout(eventTimer);
      clearInterval(expiry);
      void db.removeChannel(channel);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
    };
  }, [conversationId, enabled, accountId, user?.id, scope, tabId]);
  return {
    peers:
      state.scope === scope
        ? state.peers.filter((peer) => peer.expiresAt > now)
        : [],
    unavailable: enabled && state.scope === scope && state.unavailable,
    now,
  };
}
