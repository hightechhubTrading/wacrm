'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Hand,
  Undo2,
  Loader2,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { SalesAssistanceBrief } from './sales-assistance-brief';
import { useAuth } from '@/hooks/use-auth';

// ------------------------------------------------------------
// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches instead of hitting
// /api/ai/config every time the agent opens a chat.
//
// Keyed by accountId (a multi-account user switching workspaces must not
// see the previous account's status), and only *successful* fetches are
// cached — a transient failure returns a default without poisoning the
// cache, so it retries on the next thread open rather than hiding the
// banner for the whole session.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
  unavailable?: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

async function fetchAiAccountStatus(
  accountId: string
): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch('/api/ai/config', { cache: 'no-store' });
    if (!res.ok) return { autoReplyOn: false, unavailable: true }; // don't cache a transient failure
    const j = await res.json();
    const status = {
      // AI auto-reply is "live" only when configured, the master switch
      // is on, and the inbound bot is enabled.
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false, unavailable: true }; // don't cache
  }
}

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
  /** `conversations.ai_context_summary` — cached recap AI wrote while
   * covering this thread after hours (migration 051), shown to the
   * assigned agent so they don't have to scroll the overnight
   * exchange to catch up. */
  contextSummary?: string | null;
  /** Current assignee; when a human owns the thread the bot won't run,
   *  so the "AI active" banner is suppressed. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" assigns the thread to them. */
  currentUserId?: string | null;
  /** Called after a successful toggle so the parent can patch its local
   *  conversation state (the realtime UPDATE also arrives, but this keeps
   *  the banner instant). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
  /** Summary is rendered separately in the floating conversation note. */
  hideSummary?: boolean;
  compact?: boolean;
  alwaysShow?: boolean;
  onOpenControls?: () => void;
}

/**
 * Inbox banner that surfaces + controls the AI auto-reply bot per
 * conversation:
 *   - bot active here → "AI is replying automatically" + [Take over]
 *   - bot paused here → the handoff note (if any) + [Resume AI]
 * Renders nothing when the account has no auto-reply configured, or when
 * the bot is active but a human already owns the thread (nothing to do).
 */
export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  contextSummary,
  assignedAgentId,
  currentUserId,
  hideSummary = false,
  compact = false,
  alwaysShow = false,
  onOpenControls,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations('Inbox.aiBanner');
  const { accountId } = useAuth();
  const [autoReplyOn, setAutoReplyOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // Optimistic local mirror of the pause flag so the banner flips
  // instantly on click; re-seeds whenever the thread (or its server
  // state via realtime) changes.
  const [paused, setPaused] = useState(disabled);
  useEffect(() => setPaused(disabled), [conversationId, disabled]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    setAutoReplyOn(null);
    setUnavailable(false);
    fetchAiAccountStatus(accountId).then((s) => {
      if (!alive) return;
      setAutoReplyOn(s.autoReplyOn);
      setUnavailable(s.unavailable ?? false);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const toggle = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // "Take over" also assigns the thread to the acting agent.
          body: JSON.stringify({ paused, assign_to_me: paused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t('updateError'));
          return;
        }
        setPaused(paused);
        onChange?.({
          ai_autoreply_disabled: paused,
          // Take over assigns to the acting agent; resume releases only
          // the caller's own assignment. The realtime UPDATE reconciles
          // the exact value either way.
          ...(paused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(paused ? t('tookOver') : t('resumed'));
      } catch {
        toast.error(t('networkError'));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t]
  );

  const status =
    autoReplyOn === null
      ? 'checkingStatus'
      : unavailable
        ? 'unavailableStatus'
        : !autoReplyOn
          ? 'manualStatus'
          : paused
            ? 'pausedTitle'
            : assignedAgentId
              ? 'teamStatus'
              : 'activeText';
  if (compact)
    return (
      <button type="button" className="crm-ai-status" onClick={onOpenControls}>
        <Sparkles size={16} aria-hidden />
        <span>{t(status)}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
    );
  if (!autoReplyOn && alwaysShow)
    return (
      <Banner tone="muted">
        <Sparkles size={17} aria-hidden />
        <span>{t(status)}</span>
      </Banner>
    );
  if (autoReplyOn && assignedAgentId && !paused && alwaysShow)
    return (
      <Banner tone="muted">
        <Hand size={17} aria-hidden />
        <span>{t('teamStatus')}</span>
      </Banner>
    );

  // Account has no auto-reply → nothing to show. (Still loading → nothing.)
  if (!autoReplyOn) return null;

  // Paused here (a human took over, or the model handed off).
  if (paused) {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium">{t('pausedTitle')}</p>
          {handoffSummary && !hideSummary && (
            <p
              className="text-muted-foreground truncate"
              title={handoffSummary}
            >
              {handoffSummary}
            </p>
          )}
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
          {t('resume')}
        </BannerButton>
      </Banner>
    );
  }

  // A human owns the thread, but AI covered it after hours (context
  // summary cached, see auto-reply.ts) — surface the recap so the
  // returning agent doesn't have to scroll the overnight exchange.
  if (assignedAgentId && contextSummary) {
    if (hideSummary) return null;
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium">{t('afterHoursTitle')}</p>
          <p className="text-muted-foreground truncate" title={contextSummary}>
            {contextSummary}
          </p>
        </div>
      </Banner>
    );
  }

  // Active, but a human already owns it → the bot won't fire; no banner.
  if (assignedAgentId) return null;

  // Active on this thread.
  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="text-primary h-3.5 w-3.5 flex-shrink-0" />
        <span className="text-foreground truncate font-medium">
          {t('activeText')}
        </span>
      </div>
      <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
        {t('takeOver')}
      </BannerButton>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'primary' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4',
        tone === 'primary'
          ? 'border-primary/20 bg-primary/5'
          : 'border-border bg-muted/40'
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="border-border bg-card text-foreground hover:bg-muted inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}

/** Stored AI context stays visible independently of the auto-reply master switch. */
export function AiConversationNote({
  conversationId,
  contextSummary,
  handoffSummary,
  paused,
  priorityReason,
  refreshToken,
  onOpenTools,
  onPrepareReply,
  sessionExpired,
}: {
  conversationId: string;
  contextSummary?: string | null;
  handoffSummary?: string | null;
  paused: boolean;
  priorityReason?: string | null;
  refreshToken?: number;
  onOpenTools: () => void;
  onPrepareReply?: () => void;
  sessionExpired?: boolean;
}) {
  const t = useTranslations('Inbox.aiBanner');
  const [expanded, setExpanded] = useState(false);
  const [stored, setStored] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  const direct =
    (paused ? handoffSummary?.trim() : '') ||
    contextSummary?.trim() ||
    handoffSummary?.trim();
  useEffect(() => {
    if (direct) return;
    const controller = new AbortController();
    void (async () => {
      const { data } = await createClient()
        .from('contact_notes')
        .select('note_text')
        .eq('conversation_id', conversationId)
        .eq('is_ai_generated', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .abortSignal(controller.signal)
        .maybeSingle();
      if (!controller.signal.aborted)
        setStored({
          conversationId,
          text:
            data?.note_text?.replace(/^(?:🤖\s*)?AI summary:\s*/i, '').trim() ??
            '',
        });
    })().catch(() => {
      /* Keep the stored conversation context available during a failed fallback read. */
    });
    return () => controller.abort();
  }, [conversationId, direct, refreshToken]);
  const summary =
    direct || (stored?.conversationId === conversationId ? stored.text : '');
  const text = summary || priorityReason;
  return (
    <aside className="crm-ai-note" aria-label={t('noteTitle')}>
      <header>
        <span className="crm-ai-note-icon" aria-hidden="true">
          <Sparkles size={21} />
          <i />
        </span>
        <div>
          <h3>{t('noteTitle')}</h3>
          <p>{t('internalNote')}</p>
        </div>
      </header>
      {paused && <span className="crm-ai-note-state">{t('pausedTitle')}</span>}
      {!summary && priorityReason && (
        <span className="crm-ai-note-state crm-ai-note-priority-state">{t('priorityContext')}</span>
      )}
      <SalesAssistanceBrief
        conversationId={conversationId}
        refreshToken={refreshToken}
        onPrepareReply={onPrepareReply}
        sessionExpired={sessionExpired}
      />
      <p
        dir="auto"
        className={cn('crm-ai-note-text', expanded && 'crm-ai-note-expanded')}
      >
        {text || t('noNote')}
      </p>
      {text && (
        <button
          type="button"
          className="crm-ai-note-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? 'showLess' : 'readNote')}
          <ChevronDown size={14} aria-hidden />
        </button>
      )}
      <button type="button" className="crm-ai-note-tools" onClick={onOpenTools}>
        <SlidersHorizontal size={14} aria-hidden />
        {t('openTools')}
      </button>
    </aside>
  );
}
