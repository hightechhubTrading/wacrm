'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { ConversationCalling } from '@/components/calling/conversation-calling';
import { usePresence } from '@/hooks/use-presence';
import { PresenceDot } from '@/components/presence/presence-dot';
import { presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  InteractiveMessagePayload,
} from '@/types';
import {
  Flame,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  Sparkles,
  CalendarClock,
  BriefcaseBusiness,
} from 'lucide-react';
import { format, isToday, isYesterday, differenceInHours } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { QuotationAttachment } from '@/components/quotations/quotation-attachment';
import { isMessageContinuation } from '@/lib/inbox/message-groups';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MessageBubble } from './message-bubble';
import { MessageActions } from './message-actions';
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from './message-composer';
import { deleteAccountMedia } from '@/lib/storage/upload-media';
import { TemplatePicker } from './template-picker';
import { AiThreadBanner, AiConversationNote } from './ai-thread-banner';
import { ContactSidebar } from './contact-sidebar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { NextSalesAction } from './sales-workspace';
import { AiFollowups } from './ai-followups';
import { Agenda } from '@/components/dashboard/agenda';
import { buildReplyPreview } from './reply-quote';
import { toast } from 'sonner';

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
}

function formatDateSeparator(
  dateStr: string,
  t: ReturnType<typeof useTranslations>,
  locale: string
): string {
  const date = new Date(dateStr);
  if (isToday(date)) return t('today');
  if (isYesterday(date)) return t('yesterday');
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = '';

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), 'yyyy-MM-dd');
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: {
  label: string;
  value: ConversationStatus;
  color: string;
}[] = [
  { label: 'Open', value: 'open', color: 'text-info' },
  { label: 'Pending', value: 'pending', color: 'text-warning' },
  { label: 'Closed', value: 'closed', color: 'text-success' },
];

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
}: MessageThreadProps) {
  const [toolsView, setToolsView] = useState<
    'assistant' | 'followups' | 'sales' | null
  >(null);
  const returnToComposer = useRef(false);
  const [aiOverride, setAiOverride] = useState<{
    id: string;
    paused: boolean;
  } | null>(null);
  const t = useTranslations('Inbox.messageThread');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const followupTarget = searchParams.get('followup');
  const quotationTarget = searchParams.get('quotation');
  const quotationDocument = searchParams.get('document');
  const aiPaused =
    aiOverride && aiOverride.id === conversation?.id
      ? aiOverride.paused
      : (conversation?.ai_autoreply_disabled ?? false);
  useEffect(() => {
    setToolsView(followupTarget ? 'followups' : null);
    returnToComposer.current = false;
  }, [conversation?.id, followupTarget]);
  useEffect(() => {
    setAiOverride(null);
  }, [conversation?.id, conversation?.ai_autoreply_disabled]);
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent).detail?.conversationId === conversation?.id)
        setToolsView('followups');
    };
    const focusComposer = () => setToolsView(null);
    window.addEventListener('open-sales-followups', open);
    window.addEventListener('focus-sales-composer', focusComposer);
    return () => {
      window.removeEventListener('open-sales-followups', open);
      window.removeEventListener('focus-sales-composer', focusComposer);
    };
  }, [conversation?.id]);
  const tTimer = useTranslations('Inbox.sessionTimer');
  const tQuote = useTranslations('Inbox.replyQuote');

  const { user } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mobileJobOpen, setMobileJobOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [messageFetchError, setMessageFetchError] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — `profiles_select` (migration 017) lets any account member read
  // every profile row in their account, which is what populates the
  // assign dropdown for shared-team workspaces.
  //
  // Explicit column list, NOT `select("*")`: that RLS policy is
  // row-level, so `*` would ship every column of every teammate's row to
  // this browser. Add columns here as the UI needs them.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select(
        'id, user_id, full_name, email, avatar_url, role, account_id, account_role, created_at'
      )
      .order('full_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Failed to fetch profiles:', error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: '' };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === 'customer');

    if (!lastCustomerMsg)
      return { expired: true, remaining: 'No customer messages' };

    const hoursSince = differenceInHours(
      new Date(),
      new Date(lastCustomerMsg.created_at)
    );
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: tTimer('expired') };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? tTimer('xhRemaining', { hours: Math.floor(hoursLeft) })
        : tTimer('xmRemaining', { minutes: Math.floor(hoursLeft * 60) });

    return { expired, remaining };
  }, [messages, tTimer]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (error) {
        setMessageFetchError(true);
        console.error('Failed to fetch messages:', error);
      } else {
        setMessageFetchError(false);
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('message_reactions')
        .select('*')
        .eq('conversation_id', conversationId);
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch reactions:', error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith('temp-') &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)
      .then(({ error }) => {
        if (error) console.error('Failed to reset unread_count:', error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'text',
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error('Failed to send message:', reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send message:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === 'document'
          ? payload.caption || payload.filename || 'Document'
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error('Failed to send media:', reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: 'failed' });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          // Never GC a catalog pick — it's a shared/reusable asset in a
          // different bucket, not a one-off upload.
          if (payload.source === 'upload') {
            void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(
              () => {}
            );
          }
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send media:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
        if (payload.source === 'upload') {
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(
            () => {}
          );
        }
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendInteractive = useCallback(
    async (payload: InteractiveMessagePayload, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;
      // Optimistic bubble — renders the buttons/list immediately via the
      // interactive_payload, same as the persisted row will.
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: 'interactive',
        content_text: payload.body,
        interactive_payload: payload,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'interactive',
            interactive_payload: payload,
            reply_to_message_id: replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error('Failed to send interactive message:', reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send interactive message:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      await supabase
        .from('conversations')
        .update({ status })
        .eq('id', conversation.id);

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      }
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: 'template',
        content_text: renderedBody,
        template_name: template.name,
        status: 'sending',
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'template',
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error('Failed to send template:', reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send template:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || 'Customer';

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg = m.sender_type === 'agent' || m.sender_type === 'bot';
      return isAgentMsg ? 'You' : contactDisplayName;
    },
    [contactDisplayName]
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, tQuote),
      });
    },
    [authorLabelFor, tQuote]
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn('[reactions] missing user or conversation');
        return;
      }
      if (messageId.startsWith('temp-')) {
        toast.error('Wait for the message to finish sending');
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === 'agent' &&
            r.actor_id === userId
        );
        if (emoji === '') return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: 'agent',
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch('/api/whatsapp/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id]
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('id', conversation.id);

      if (error) {
        console.error('Failed to update assignment:', error);
        toast.error('Failed to update assignment');
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange]
  );

  if (!conversation || !contact) {
    return (
      <div className="crm-thread crm-inbox-overview">
        <div className="crm-inbox-overview-heading">
          <h2>{t('welcomeTitle')}</h2>
          <p>{t('welcomeHint')}</p>
        </div>
        <Agenda />
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? t('assigned'))
    : t('assign');
  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn('flex min-w-0 flex-1 flex-col', 'crm-thread')}>
      {/* Contact identity and conversation controls. */}
      <div className="crm-thread-header border-border bg-card flex items-center justify-between gap-2 border-b px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t('backToConversations')}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md lg:hidden"
            >
              <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
            </button>
          )}
          <div className="crm-thread-avatar bg-muted text-foreground flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium">
            {displayName.charAt(0).toUpperCase()}
            {contact.avatar_url && (
              <img
                src={contact.avatar_url}
                alt=""
                className="crm-header-photo"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-sm font-semibold">
              {displayName}
            </h2>
            <p
              dir="ltr"
              className="crm-contact-phone text-muted-foreground truncate text-xs"
            >
              {contact.phone}
            </p>
          </div>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. */}
          <Badge
            variant="outline"
            className={cn(
              'border-border ms-1 hidden gap-1 text-[10px] sm:ms-2 sm:inline-flex',
              sessionInfo.expired ? 'text-destructive' : 'text-primary'
            )}
          >
            <Clock className="h-3 w-3" />
            {sessionInfo.remaining}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <ConversationCalling key={conversation.id} conversationId={conversation.id} name={displayName} />
          {/* Contact-panel toggle — desktop only. The contact sidebar
              eats a chunk of horizontal width that crowds the thread on
              smaller laptops; this lets agents reclaim it when they just
              want to read and reply. Hidden on mobile, where the sidebar
              never renders as a permanent panel anyway. Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? t('hideContactPanel') : t('showContactPanel')
              }
              title={contactPanelOpen ? t('hideContact') : t('showContact')}
              aria-pressed={contactPanelOpen}
              className={cn(
                'hover:bg-muted hover:text-foreground hidden h-7 w-7 items-center justify-center rounded-md transition-colors lg:inline-flex',
                contactPanelOpen ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          <button
            type="button"
            className="text-muted-foreground hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md lg:hidden"
            aria-label={t('showContactPanel')}
            onClick={() => setMobileJobOpen(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label={t('refreshConversation')}
              title={t('refresh')}
              className={cn(
                'text-muted-foreground hover:bg-muted hover:text-foreground hidden h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-60'
              )}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
              />
            </button>
          )}

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs',
                currentStatus?.color ?? 'text-muted-foreground'
              )}
            >
              {currentStatus ? t(`status${currentStatus.label}`) : t('status')}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn('text-sm', opt.color)}
                >
                  {t(`status${opt.label}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs',
                assignedAgentId ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground text-sm"
                >
                  {t('noTeammates')}
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        'text-sm',
                        isSelected ? 'text-primary' : 'text-popover-foreground'
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
                        )}
                        className="me-2"
                      />
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? t('me') : ''}
                      </span>
                      {isSelected && <Check className="ms-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-muted-foreground text-sm"
                  >
                    {t('unassign')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Sheet open={mobileJobOpen} onOpenChange={setMobileJobOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('showContactPanel')}</SheetTitle>
          </SheetHeader>
          <ContactSidebar
            key={conversation.id}
            contact={contact}
            conversation={conversation}
            sharedMessages={messages}
            refreshToken={messages.length}
            onOpenSharedMessage={(id) => {
              setMobileJobOpen(false);
              requestAnimationFrame(() => {
                const element = document.getElementById(`message-${id}`);
                element?.scrollIntoView({
                  block: 'center',
                  behavior: 'instant',
                });
                element?.focus({ preventScroll: true });
              });
            }}
          />
        </SheetContent>
      </Sheet>

      <AiFollowups
        key={`overview-${conversation.id}`}
        conversationId={conversation.id}
        preview
        onOpen={() => setToolsView('followups')}
      />
      {/* Messages Area */}

      <div className="crm-transcript">
        <AiConversationNote
          key={conversation.id}
          conversationId={conversation.id}
          contextSummary={conversation.ai_context_summary}
          handoffSummary={conversation.ai_handoff_summary}
          paused={aiPaused}
          priorityReason={
            conversation.status !== 'closed' &&
            ['urgent', 'high'].includes(conversation.ai_priority ?? '')
              ? conversation.ai_priority_reason
              : null
          }
          refreshToken={resyncToken}
          onOpenTools={() => setToolsView('assistant')}
          sessionExpired={sessionInfo.expired}
          onPrepareReply={() => {
            if (sessionInfo.expired) handleOpenTemplates();
            else
              window.dispatchEvent(
                new CustomEvent('draft-sales-reply', {
                  detail: { conversationId: conversation.id },
                })
              );
          }}
        />
        <div
          ref={scrollRef}
          className="crm-message-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          {loading ? (
            <div
              className="crm-message-skeleton"
              role="status"
              aria-label={t('loadingMessages')}
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden
                  className={index % 2 ? 'crm-skeleton-outgoing' : ''}
                />
              ))}
            </div>
          ) : messageFetchError ? (
            <div className="crm-thread-state" role="status">
              <p>{t('loadError')}</p>
              <button onClick={onRefresh} className="text-primary">
                {t('retryMessages')}
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground text-sm">
                {t('noMessagesYet')}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('sendTemplateHint')}
              </p>
            </div>
          ) : (
            <div className="crm-message-column space-y-4">
              {messageGroups.map((group) => (
                <div key={group.date}>
                  {/* Date separator */}
                  <div className="crm-message-date mb-4 flex items-center justify-center">
                    <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-[10px] font-medium">
                      {formatDateSeparator(group.date, t, locale)}
                    </span>
                  </div>
                  {/* Messages */}
                  <div className="space-y-2">
                    {group.messages.map((msg, index) => {
                      const continuation = isMessageContinuation(
                        group.messages[index - 1],
                        msg
                      );
                      const parent = msg.reply_to_message_id
                        ? messagesById.get(msg.reply_to_message_id)
                        : null;
                      const reply = parent
                        ? {
                            authorLabel:
                              parent.sender_type === 'agent' ||
                              parent.sender_type === 'bot'
                                ? t('me')
                                : contact?.name || contact?.phone || 'Unknown',
                            preview: buildReplyPreview(parent, tQuote),
                          }
                        : null;
                      const msgReactions = reactionsByMessageId.get(msg.id);
                      // Toggle is computed at the call site — `msgReactions`
                      // and `user?.id` are already in scope, no extra hook.
                      const handlePillToggle = (emoji: string) => {
                        const own = msgReactions?.find(
                          (r) =>
                            r.actor_type === 'agent' && r.actor_id === user?.id
                        );
                        const next = own?.emoji === emoji ? '' : emoji;
                        void postReaction(msg.id, next);
                      };
                      return (
                        <MessageActions
                          key={msg.id}
                          message={msg}
                          continuation={continuation}
                          onReply={() => handleStartReply(msg)}
                          onReact={(emoji) => {
                            if (emoji) void postReaction(msg.id, emoji);
                          }}
                        >
                          <MessageBubble
                            message={msg}
                            authorLabel={
                              continuation
                                ? undefined
                                : msg.sender_type === 'customer'
                                  ? displayName
                                  : msg.ai_generated
                                    ? t('aiAuthor')
                                    : msg.sender_type === 'bot'
                                      ? t('automationAuthor')
                                      : t('you')
                            }
                            reply={reply}
                            reactions={msgReactions}
                            currentUserId={user?.id}
                            onToggleReaction={handlePillToggle}
                          />
                        </MessageActions>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <nav className="crm-reply-toolbar" aria-label={t('replyTools')}>
        <AiThreadBanner
          compact
          hideSummary
          onOpenControls={() => setToolsView('assistant')}
          conversationId={conversation.id}
          disabled={aiPaused}
          assignedAgentId={assignedAgentId}
        />
        <div className="crm-reply-shortcuts">
          <button type="button" onClick={() => setToolsView('followups')}>
            <CalendarClock size={16} aria-hidden />
            {t('followupTools')}
          </button>
          <button type="button" onClick={() => setToolsView('sales')}>
            <BriefcaseBusiness size={16} aria-hidden />
            {t('salesTools')}
          </button>
        </div>
      </nav>
      <Sheet
        onOpenChangeComplete={(open) => {
          if (!open && returnToComposer.current) {
            returnToComposer.current = false;
            window.dispatchEvent(new Event('focus-sales-composer'));
          }
        }}
        open={toolsView !== null}
        onOpenChange={(open) => !open && setToolsView(null)}
      >
        <SheetContent
          side={locale === 'ar' ? 'left' : 'right'}
          className="crm-conversation-tools"
        >
          <SheetHeader>
            <SheetTitle>{t('replyTools')}</SheetTitle>
            <p className="text-muted-foreground text-sm">
              {contact?.name || contact?.phone || t('unknownContact')}
            </p>
          </SheetHeader>
          <Tabs
            value={toolsView ?? 'assistant'}
            onValueChange={(value) =>
              setToolsView(value as 'assistant' | 'followups' | 'sales')
            }
          >
            <TabsList className="crm-tools-tabs">
              <TabsTrigger value="assistant">
                <Sparkles size={16} aria-hidden />
                {t('assistantTools')}
              </TabsTrigger>
              <TabsTrigger value="followups">
                <CalendarClock size={16} aria-hidden />
                {t('followupTools')}
              </TabsTrigger>
              <TabsTrigger value="sales">
                <BriefcaseBusiness size={16} aria-hidden />
                {t('salesTools')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="assistant">
              <section className="crm-assistant-settings">
                <div className="crm-tools-identity">
                  <Sparkles size={24} aria-hidden />
                  <div>
                    <h3>{t('autoReplyTitle')}</h3>
                    <p>{t('autoReplyDescription')}</p>
                  </div>
                </div>
                <AiThreadBanner
                  alwaysShow
                  hideSummary
                  conversationId={conversation.id}
                  disabled={aiPaused}
                  assignedAgentId={assignedAgentId}
                  currentUserId={user?.id}
                  onChange={(patch) => {
                    setAiOverride({
                      id: conversation.id,
                      paused: patch.ai_autoreply_disabled,
                    });
                    if ('assigned_agent_id' in patch)
                      onAssignChange(
                        conversation.id,
                        patch.assigned_agent_id ?? null
                      );
                  }}
                />
                <p className="crm-tools-explanation">{t('autoReplyHelp')}</p>
                <div className="crm-tools-divider" />
                <h3>{t('draftingTitle')}</h3>
                <p className="crm-tools-explanation">{t('draftingHelp')}</p>
              </section>
            </TabsContent>
            <TabsContent value="followups">
              <AiFollowups
                key={conversation.id}
                conversationId={conversation.id}
                standalone
              />
            </TabsContent>
            <TabsContent value="sales">
              <NextSalesAction
                key={conversation.id}
                conversation={conversation}
                sessionExpired={sessionInfo.expired}
                onReply={() => {
                  setToolsView(null);
                  if (sessionInfo.expired) handleOpenTemplates();
                  else returnToComposer.current = true;
                }}
                onOpenJob={() => {
                  setToolsView(null);
                  setMobileJobOpen(true);
                }}
              />
              {conversation.status !== 'closed' &&
                ['urgent', 'high'].includes(conversation.ai_priority ?? '') &&
                conversation.ai_priority_reason && (
                  <div className="crm-thread-brief">
                    <Flame aria-hidden />
                    <p dir="auto">
                      <span>{t('priorityBrief')}</span>
                      {conversation.ai_priority_reason}
                    </p>
                  </div>
                )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
      {quotationTarget && quotationDocument && (
        <QuotationAttachment
          key={`${conversation.id}:${quotationDocument}`}
          quotationId={quotationTarget}
          documentId={quotationDocument}
          conversationId={conversation.id}
          sessionExpired={sessionInfo.expired}
          onSent={onNewMessage}
        />
      )}
      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onSendInteractive={handleSendInteractive}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
