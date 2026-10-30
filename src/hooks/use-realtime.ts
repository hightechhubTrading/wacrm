'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Message, Conversation } from '@/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface RealtimeEvent<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  onReconnect?: () => void;
  enabled?: boolean;
}

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  onReconnect,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retryConnection = useCallback(
    () => setAttempt((value) => value + 1),
    []
  );

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures. Assigned inside an effect
  // so the mutation doesn't happen during render (React 19's refs
  // rule) — subscribers only read `.current` inside async Realtime
  // callbacks, which always run after the render that updates it.
  const onReconnectRef = useRef(onReconnect);
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onReconnectRef.current = onReconnect;
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();

    let hasConnected = attempt > 0;
    let disposed = false;
    let connected = false;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>['eventType'],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          onConversationRef.current?.({
            eventType:
              payload.eventType as RealtimeEvent<Conversation>['eventType'],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .subscribe((status) => {
        if (disposed) return;
        const next = status === 'SUBSCRIBED';
        if (next && !connected) {
          if (hasConnected) onReconnectRef.current?.();
          hasConnected = true;
          setLastConnectedAt(Date.now());
        }
        connected = next;
        setIsConnected(next);
      });

    channelRef.current = channel;

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [channelName, enabled, attempt]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, lastConnectedAt, retryConnection, unsubscribe };
}
