'use client';

import { useAuth } from '@/hooks/use-auth';
import {
  ThreadPreviewCache,
  fetchRecentMessagePage,
  type RecentMessagePage,
} from '@/lib/inbox/thread-previews';
import { DeferredContactPanel } from '@/components/inbox/deferred-contact-panel';
import {
  mergeMessageHistory,
  MESSAGE_PAGE_SIZE,
} from '@/lib/inbox/message-history';
import {
  Suspense,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import type {
  Conversation,
  Message,
  Contact,
  ConversationStatus,
} from '@/types';
import { useRealtime } from '@/hooks/use-realtime';
import { ConversationList } from '@/components/inbox/conversation-list';
import { MessageThread } from '@/components/inbox/message-thread';
import { WifiOff } from 'lucide-react';
import { ConnectionNotice } from '@/components/inbox/connection-notice';
import { cn } from '@/lib/utils';

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = 'wacrm:inbox:contact-panel-open';
let contactPanelFallback = true;
function contactPanelSnapshot() {
  try {
    const value = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
    return value === null ? contactPanelFallback : value === 'true';
  } catch {
    return contactPanelFallback;
  }
}
function subscribeContactPanel(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('crm-contact-panel', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('crm-contact-panel', callback);
  };
}

// `useSearchParams` (the `?c=<id>` deep link below) requires a Suspense
// boundary or the production build bails to CSR and errors out. Thin
// wrapper supplies it; the inner component holds all the inbox state.
export default function InboxPage() {
  const { accountId, user } = useAuth();
  return (
    <Suspense fallback={null}>
      <InboxPageInner key={`${accountId}:${user?.id}`} />
    </Suspense>
  );
}

function InboxPageInner() {
  const t = useTranslations('Inbox.page');
  const livePage = useRef(true),
    searchOpenSequence = useRef(0);
  useEffect(() => {
    livePage.current = true;
    return () => {
      livePage.current = false;
    };
  }, []);
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get('c');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lastSynchronizedAt, setLastSynchronizedAt] = useState<number | null>(
    null
  );
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const selectedConversation = useRef<string | null>(null);
  useLayoutEffect(() => {
    selectedConversation.current = activeConversation?.id ?? null;
    return () => {
      selectedConversation.current = null;
    };
  }, [activeConversation?.id]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCache] = useState(() => new ThreadPreviewCache());
  const [readyConversationId, setReadyConversationId] = useState<string | null>(
    null
  );
  const prefetched = useRef(
    new Map<string, { at: number; page: Promise<RecentMessagePage> }>()
  );
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const prefetchBusy = useRef(false);
  const getRecentMessages = useCallback((id: string) => {
    const entry = prefetched.current.get(id);
    prefetched.current.delete(id);
    if (entry && Date.now() - entry.at < 5000) return entry.page;
    return fetchRecentMessagePage(createClient(), id);
  }, []);
  const prefetchConversation = useCallback(
    (conversation: Conversation | null) => {
      clearTimeout(prefetchTimer.current);
      if (!conversation || messageCache.get(conversation.id)) return;
      const id = conversation.id;
      prefetchTimer.current = setTimeout(() => {
        if (prefetchBusy.current || prefetched.current.has(id)) return;
        prefetchBusy.current = true;
        const page = fetchRecentMessagePage(createClient(), id);
        prefetched.current.set(id, { at: Date.now(), page });
        while (prefetched.current.size > 3) {
          prefetched.current.delete(prefetched.current.keys().next().value!);
        }
        void page
          .then((result) => {
            if (result.error) prefetched.current.delete(id);
            else if (result.data) {
              messageCache.set(
                id,
                result.data.slice(0, MESSAGE_PAGE_SIZE).reverse()
              );
            }
          })
          .catch(() => {
            prefetched.current.delete(id);
          })
          .finally(() => {
            prefetchBusy.current = false;
          });
      }, 150);
    },
    [messageCache]
  );
  useEffect(() => () => clearTimeout(prefetchTimer.current), []);
  useEffect(() => {
    if (activeConversation && readyConversationId === activeConversation.id) {
      messageCache.set(activeConversation.id, messages);
    }
  }, [activeConversation, readyConversationId, messages, messageCache]);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);
  const [listRefreshToken, setListRefreshToken] = useState(0);

  /**
   * Bumped whenever a new message lands on the active conversation —
   * the signal ContactSidebar uses to refetch deals (and their
   * order-info fields), since the AI bot may have just written to
   * them via `[[SET_FIELD:...]]`. No dedicated realtime channel on
   * `deals` exists anywhere in the app; this piggybacks on the
   * message-event handling already happening here instead of adding
   * a first one just for this.
   */
  const [dealsRefreshToken, setDealsRefreshToken] = useState(0);

  const contactPanelOpen = useSyncExternalStore(
    subscribeContactPanel,
    contactPanelSnapshot,
    () => true
  );
  const handleToggleContactPanel = useCallback(() => {
    const next = !contactPanelSnapshot();
    contactPanelFallback = next;
    try {
      localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
    } catch {
      /* Keep this tab's preference when storage is unavailable. */
    }
    window.dispatchEvent(new Event('crm-contact-panel'));
  }, []);

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      const { data } = await supabase
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle();

      setWhatsappConnected(data?.status === 'connected');
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;
      setListRefreshToken((value) => value + 1);

      if (event.eventType === 'INSERT') {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Incoming customer messages must not erase unrelated pending sends.
            // The POST/reconciliation result settles its own optimistic identity.
            return [...prev, newMsg];
          });
          setDealsRefreshToken((v) => v + 1);
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state before patching
        // its preview — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? '',
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c
            )
          );
        }
      }

      if (event.eventType === 'UPDATE') {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;
      setListRefreshToken((value) => value + 1);

      if (event.eventType === 'UPDATE') {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c
            )
          );
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) =>
            prev?.id === conv.id ? { ...prev, ...conv } : prev
          );
        }
      }
    },
    [activeConversation]
  );

  // Reconcile list/history directly when the realtime subscription reconnects.
  const { isConnected, lastConnectedAt, retryConnection } = useRealtime({
    channelName: 'inbox-realtime',
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    onReconnect: () => setResyncToken((value) => value + 1),
    enabled: true,
  });

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      setLastSynchronizedAt(Date.now());
      if (
        !deepLinkConvId ||
        autoSelectedForDeepLinkRef.current === deepLinkConvId
      )
        return;
      autoSelectedForDeepLinkRef.current = deepLinkConvId;
      if (activeConversation?.id === deepLinkConvId) return;
      const open = (match: Conversation) => {
        if (
          new URLSearchParams(window.location.search).get('c') !==
          deepLinkConvId
        )
          return;
        setActiveConversation(match);
        setActiveContact(match.contact ?? null);
        const cached = messageCache.get(match.id);
        setMessages(cached ?? []);
        setReadyConversationId(cached ? match.id : null);
        if (match.unread_count > 0)
          setConversations((previous) =>
            previous.map((row) =>
              row.id === match.id ? { ...row, unread_count: 0 } : row
            )
          );
      };
      const match = loaded.find((row) => row.id === deepLinkConvId);
      if (match) open(match);
      else {
        // A shared URL can reference a conversation outside the loaded page or
        // current filters. Fetch just that authorized row instead of all chats.
        void createClient()
          .from('conversations')
          .select(CONVERSATION_SELECT)
          .eq('id', deepLinkConvId)
          .maybeSingle()
          .then(({ data }) => {
            if (data) open(normalizeConversation(data));
          });
      }
    },
    [deepLinkConvId, activeConversation?.id, messageCache]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) {
        const url = new URL(window.location.href);
        if (url.searchParams.has('m')) {
          url.searchParams.delete('m');
          window.history.replaceState(
            window.history.state,
            '',
            url.pathname + url.search + url.hash
          );
        }
        return;
      }
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      clearTimeout(prefetchTimer.current);
      const cached = messageCache.get(conv.id);
      setMessages(cached ?? []);
      setReadyConversationId(cached ? conv.id : null);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c
        )
      );
      // Mark this selection before syncing the URL so a later list
      // refresh cannot auto-select it again and clear loaded messages.
      autoSelectedForDeepLinkRef.current = conv.id;
      // Selection is client state, not a new server route. Next's native
      // History integration updates useSearchParams without an RSC fetch
      // or pending server render for every chat click.
      const url = new URL(window.location.href);
      url.searchParams.set('c', conv.id);
      url.searchParams.delete('followup');
      url.searchParams.delete('m');
      window.history.replaceState(
        null,
        '',
        `${url.pathname}${url.search}${url.hash}`
      );
    },
    [activeConversation?.id, messageCache]
  );

  const handleOpenMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      const version = ++searchOpenSequence.current;
      const { data, error } = await createClient()
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .eq('id', conversationId)
        .maybeSingle();
      if (
        error ||
        !data ||
        !livePage.current ||
        version !== searchOpenSequence.current
      )
        return false;
      handleSelectConversation(normalizeConversation(data));
      const url = new URL(window.location.href);
      url.searchParams.set('c', conversationId);
      url.searchParams.set('m', messageId);
      window.history.replaceState(
        window.history.state,
        '',
        url.pathname + url.search + url.hash
      );
      return true;
    },
    [handleSelectConversation]
  );

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('c');
    url.searchParams.delete('m');
    url.searchParams.delete('followup');
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }, []);

  const handleMessagesLoaded = useCallback(
    (loaded: Message[], merge = false) => {
      if (
        !livePage.current ||
        selectedConversation.current !== activeConversation?.id
      )
        return;
      setMessages((previous) =>
        merge ? mergeMessageHistory(previous, loaded) : loaded
      );
      setReadyConversationId(activeConversation?.id ?? null);
    },
    [activeConversation?.id]
  );

  const handleNewMessage = useCallback((msg: Message) => {
    if (
      !livePage.current ||
      selectedConversation.current !== msg.conversation_id
    )
      return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) => {
        if (
          updates.id &&
          updates.id !== id &&
          prev.some((message) => message.id === updates.id)
        ) {
          return prev.filter((message) => message.id !== id);
        }
        return prev.map((m) => (m.id === id ? { ...m, ...updates } : m));
      });
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev?.id === conversationId ? { ...prev, status } : prev
        );
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev?.id === conversationId
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  return (
    <div className="crm-inbox -m-4 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden sm:-m-6">
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">{t('whatsappNotConnected')}</p>
        </div>
      )}

      <ConnectionNotice
        connected={isConnected}
        lastConnectedAt={lastConnectedAt}
        lastSynchronizedAt={lastSynchronizedAt}
        onRetry={() => {
          retryConnection();
          handleManualRefresh();
        }}
      />
      <div className="crm-inbox-panes flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        <div
          className={cn(
            'crm-queue-pane flex h-full flex-1 lg:flex-none',
            hasActiveConv ? 'hidden lg:flex' : 'flex'
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            onPrefetch={prefetchConversation}
            onOpenMessage={handleOpenMessage}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken + listRefreshToken}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            'crm-thread-pane flex h-full min-w-0 flex-1 lg:flex',
            hasActiveConv ? 'flex' : 'hidden lg:flex'
          )}
        >
          <MessageThread
            key={activeConversation?.id ?? 'no-conversation'}
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            messagesReady={readyConversationId === activeConversation?.id}
            getRecentMessages={getRecentMessages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onRemoveMessage={(id) =>
              setMessages((previous) =>
                previous.filter((message) => message.id !== id)
              )
            }
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only, and only when the
            agent hasn't collapsed it via the thread-header toggle (#258).
            On mobile it's always hidden (the `lg:block` below), so the
            toggle — which is itself desktop-only — never affects it. */}
        {contactPanelOpen && activeConversation && activeContact && (
          <DeferredContactPanel
            key={activeContact.id}
            ready={readyConversationId === activeConversation.id}
            contact={activeContact}
            conversation={activeConversation}
            sharedMessages={messages}
            refreshToken={dealsRefreshToken}
          />
        )}
      </div>
    </div>
  );
}
