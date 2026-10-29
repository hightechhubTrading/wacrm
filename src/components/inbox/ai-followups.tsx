'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { Input } from '@/components/ui/input';
import { CalendarClock, Plus, ChevronDown } from 'lucide-react';
import {
  FOLLOWUP_KINDS,
  type Followup,
  type FollowupKind,
} from '@/lib/ai/followups';
type Data = {
  latestHumanReplyAt?: string | null;
  mediaActions?: {
    id: string;
    status: string;
    failure_code: string | null;
    created_at: string;
  }[];
  available: boolean;
  followups: Followup[];
  latestEvent: {
    outcome: string;
    reason: string;
    created_at: string;
    details?: { providerUnavailable?: boolean };
  } | null;
  conversation: {
    assigned_agent_id: string | null;
    ai_autoreply_disabled: boolean;
    ai_handoff_summary?: string | null;
    ai_handoff_reason?: {
      reason: string;
      failures: string[];
      attempt: number;
    } | null;
  };
};
export function AiFollowups({
  conversationId,
  standalone = false,
  preview = false,
  onOpen,
}: {
  conversationId: string;
  standalone?: boolean;
  preview?: boolean;
  onOpen?: () => void;
}) {
  const t = useTranslations('Inbox.followups');
  const locale = useLocale();
  const { canSendMessages } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const target = useSearchParams().get('followup');
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const openedTarget = useRef<string | null>(null);
  const activeConversation = useRef(conversationId);
  activeConversation.current = conversationId;
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [kind, setKind] = useState<FollowupKind>('quotation');
  const [editing, setEditing] = useState<string | null>(null);
  const [evidence, setEvidence] = useState('');
  const [date, setDate] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/ai/followups/${conversationId}`, {
          cache: 'no-store',
          signal,
        });
        if (!res.ok) throw new Error('load');
        if (res.ok) {
          const next = await res.json();
          if (
            activeConversation.current === conversationId &&
            !signal?.aborted
          ) {
            setData(next);
            setNow(Date.now());
            setLoadError(false);
          }
        }
      } catch {
        if (activeConversation.current === conversationId && !signal?.aborted)
          setLoadError(true);
      }
    },
    [conversationId]
  );
  useEffect(() => {
    setBusy(false);
    setData(null);
    setLoadError(false);
    setEditing(null);
    setEvidence('');
    setDate('');
    setConfirmed('');
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible')
        void refresh(controller.signal);
    }, 30000);
    const updated = () => void refresh(controller.signal);
    window.addEventListener('sales-followups-updated', updated);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('sales-followups-updated', updated);
    };
  }, [refresh]);
  useEffect(() => {
    if (
      !target ||
      !data?.followups.some((f) => f.id === target) ||
      openedTarget.current === target
    )
      return;
    if (detailsRef.current) {
      detailsRef.current.open = true;
      openedTarget.current = target;
      detailsRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'instant',
      });
    }
  }, [target, data]);
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent).detail?.conversationId !== conversationId)
        return;
      if (detailsRef.current) {
        detailsRef.current.open = true;
        detailsRef.current.scrollIntoView({
          block: 'nearest',
          behavior: 'instant',
        });
      }
    };
    window.addEventListener('open-sales-followups', open);
    return () => window.removeEventListener('open-sales-followups', open);
  }, [conversationId]);
  async function mutate(method: 'POST' | 'PATCH', body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/followups/${conversationId}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw Error('update');
      if (activeConversation.current !== conversationId) return;
      setEditing(null);
      setEvidence('');
      setDate('');
      setConfirmed('');
      await refresh();
      window.dispatchEvent(new Event('sales-followups-updated'));
    } catch {
      if (activeConversation.current === conversationId)
        toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return standalone || preview ? (
      <div
        className={
          preview
            ? 'crm-followup-load crm-followup-load-preview'
            : 'crm-followup-load'
        }
        role={loadError ? 'alert' : 'status'}
      >
        <CalendarClock size={24} aria-hidden />
        <p>{t(loadError ? 'loadError' : 'loading')}</p>
        {loadError && (
          <Button
            variant="outline"
            onClick={() => {
              setLoadError(false);
              void refresh();
            }}
          >
            {t('retry')}
          </Button>
        )}
      </div>
    ) : null;
  const active = data.followups.filter((f) =>
    ['open', 'acknowledged', 'deferred'].includes(f.status)
  );
  if (preview) {
    const ordered = [...active].sort(
      (a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)
    );
    return (
      <section
        className="crm-followup-overview"
        aria-label={t('overviewTitle')}
      >
        <div className="crm-followup-overview-heading">
          <CalendarClock size={18} aria-hidden />
          <strong>{t('overviewTitle')}</strong>
          <span className="crm-followup-status">
            {t('title', { count: active.length })}
          </span>
          <Button size="sm" variant="outline" onClick={onOpen}>
            {t('manage')}
          </Button>
        </div>
        <p className="crm-followup-overview-context">
          {data.conversation.ai_autoreply_disabled
            ? t('paused')
            : data.conversation.assigned_agent_id
              ? t('humanOwned')
              : t('eligible')}
        </p>
        {!data.available ? (
          <p role="status">{t('unavailable')}</p>
        ) : ordered.length ? (
          <ul className="crm-followup-overview-tasks">
            {ordered.slice(0, 2).map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{t(`kinds.${task.kind}`)}</strong>
                  <small>
                    {t(`statuses.${task.status}`)} ·{' '}
                    <span
                      data-overdue={Date.parse(task.due_at) < now || undefined}
                    >
                      {Date.parse(task.due_at) < now
                        ? `${t('overdue')} · `
                        : ''}
                      {new Date(task.due_at).toLocaleString(locale, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </small>
                </div>
                <div className="crm-followup-actions">
                  {canSendMessages && task.status === 'open' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate('PATCH', {
                          id: task.id,
                          status: 'acknowledged',
                        })
                      }
                    >
                      {t('take')}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={onOpen}>
                    {t('update')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="crm-followup-overview-context">{t('empty')}</p>
        )}
        {data.available && (
          <button
            type="button"
            className="crm-followup-overview-add"
            onClick={onOpen}
          >
            <Plus size={14} aria-hidden />
            {active.length > 2
              ? t('viewAll', { count: active.length })
              : canSendMessages
                ? t('newTask')
                : t('manage')}
          </button>
        )}
      </section>
    );
  }
  const reason = data.latestEvent?.reason;
  const knownReasons = [
    'ai_disabled',
    'human_owned',
    'thread_paused',
    'business_hours',
    'automation_owned',
    'rate_limited',
    'stale_trigger',
    'no_context',
    'reply_cap',
    'slot_unavailable',
    'generation_failed',
    'reply_needs_review',
    'provider_unavailable',
    'verification_unavailable',
    'verification_failed',
    'human_authority',
    'input_complaint_or_emotion',
    'explicit_human_request',
    'attachment_unavailable',
    'reply_limit',
    'unverified_price',
    'media_delivery_uncertain',
    'media_send_failed',
    'media_conversation_changed',
    'document_review',
    'sent',
    'handoff',
    'consent_control',
    'flow_consumed',
    'interactive_reply',
    'no_readable_content',
    'conversation_unavailable',
    'handoff_failed',
  ];
  return (
    <details
      ref={detailsRef}
      open={standalone}
      className={
        standalone
          ? 'crm-followups crm-followups-standalone text-sm'
          : 'crm-followups text-sm'
      }
    >
      <summary
        className="crm-followups-heading"
        tabIndex={standalone ? -1 : undefined}
        onClick={standalone ? (event) => event.preventDefault() : undefined}
      >
        <CalendarClock size={17} aria-hidden="true" />
        <span>{t('title', { count: active.length })}</span>
        <ChevronDown
          size={16}
          className="crm-disclosure-chevron"
          aria-hidden="true"
        />
      </summary>
      {data.latestHumanReplyAt &&
        active.some(
          (f) =>
            f.created_at &&
            Date.parse(data.latestHumanReplyAt!) > Date.parse(f.created_at)
        ) && (
          <p className="text-muted-foreground mt-3 text-xs">
            {locale === 'ar'
              ? 'يوجد رد من الفريق. راجع النتيجة وحدّث حالة المتابعة.'
              : 'Staff have replied. Check the outcome and update the follow-up status.'}{' '}
            ({new Date(data.latestHumanReplyAt).toLocaleString(locale)})
          </p>
        )}
      {data.conversation.ai_handoff_summary && (
        <p className="text-muted-foreground mt-3 text-xs" dir="auto">
          {data.conversation.ai_handoff_summary}
        </p>
      )}
      {(data.mediaActions?.length ?? 0) > 0 && (
        <div
          className="my-3 space-y-1 text-xs"
          aria-label={locale === 'ar' ? 'حالة المرفقات' : 'Attachment status'}
        >
          {data.mediaActions!.map((a) => (
            <p key={a.id}>
              {locale === 'ar' ? 'المرفق' : 'Attachment'}:{' '}
              {a.status === 'accepted'
                ? locale === 'ar'
                  ? 'تم قبول الإرسال'
                  : 'Accepted by provider'
                : a.status === 'uncertain' || a.status === 'sending'
                  ? locale === 'ar'
                    ? 'راجع المحادثة قبل إعادة الإرسال'
                    : 'Check the conversation before resending'
                  : a.status === 'failed'
                    ? locale === 'ar'
                      ? 'لم يتم الإرسال؛ راجع الملف وأرسله يدوياً'
                      : 'Not sent; check the asset and send it manually'
                    : a.status}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-4 p-4">
        {!standalone && (
          <p className="text-muted-foreground">
            {data.conversation.ai_autoreply_disabled
              ? t('paused')
              : data.conversation.assigned_agent_id
                ? t('humanOwned')
                : t('eligible')}
          </p>
        )}
        {data.latestEvent?.details?.providerUnavailable && (
          <p role="status">
            {locale === 'ar'
              ? 'مزود الردود غير متاح حالياً. تم استخدام نص معتمد؛ راجع الرصيد وإعدادات المزود.'
              : 'The reply provider is unavailable. Approved wording was used; check credits and provider settings.'}
          </p>
        )}
        {reason && (
          <p>
            {t('lastAttempt')}:{' '}
            {knownReasons.includes(reason)
              ? t(`reasons.${reason}`)
              : t('reasons.other')}{' '}
            <span className="text-muted-foreground">
              {new Date(data.latestEvent!.created_at).toLocaleString()}
            </span>
          </p>
        )}
        {!data.available ? (
          <p>{t('unavailable')}</p>
        ) : (
          <>
            {standalone && active.length === 0 && (
              <p className="text-muted-foreground">{t('empty')}</p>
            )}
            {active.map((f) => (
              <div key={f.id} className="crm-followup-card">
                <div className="crm-followup-card-heading">
                  <span className="crm-followup-icon" aria-hidden="true">
                    <CalendarClock size={18} />
                  </span>
                  <div className="crm-followup-identity">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {t(`kinds.${f.kind}`)}
                      </span>
                      <span className="crm-followup-status">
                        {t(`statuses.${f.status}`)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t('due')}: {new Date(f.due_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="crm-followup-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate('PATCH', {
                          id: f.id,
                          status: 'acknowledged',
                        })
                      }
                    >
                      {t('take')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(f.id);
                        setEvidence('');
                        setDate('');
                        setConfirmed('');
                      }}
                    >
                      {t('update')}
                    </Button>
                  </div>
                </div>
                {f.confirmed_at && (
                  <p className="text-muted-foreground">
                    {t('confirmedTime')}:{' '}
                    {new Date(f.confirmed_at).toLocaleString()}
                  </p>
                )}
                {editing === f.id && (
                  <div className="crm-followup-editor">
                    <label className="flex flex-col gap-1">
                      {t('evidence')}
                      <Input
                        className="bg-card"
                        value={evidence}
                        maxLength={2000}
                        onChange={(e) => setEvidence(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      {t('deferUntil')}
                      <Input
                        type="datetime-local"
                        className="bg-card"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      {t('confirmedTime')}
                      <Input
                        type="datetime-local"
                        className="bg-card"
                        value={confirmed}
                        onChange={(e) => setConfirmed(e.target.value)}
                      />
                    </label>
                    <Button
                      size="sm"
                      disabled={busy || evidence.trim().length < 10}
                      onClick={() =>
                        void mutate('PATCH', {
                          id: f.id,
                          status: 'completed',
                          completion_evidence: evidence,
                        })
                      }
                    >
                      {t('complete')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !date}
                      onClick={() =>
                        void mutate('PATCH', {
                          id: f.id,
                          status: 'deferred',
                          due_at: new Date(date).toISOString(),
                        })
                      }
                    >
                      {t('defer')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !confirmed}
                      onClick={() =>
                        void mutate('PATCH', {
                          id: f.id,
                          status: 'acknowledged',
                          confirmed_at: new Date(confirmed).toISOString(),
                        })
                      }
                    >
                      {t('confirm')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate('PATCH', { id: f.id, status: 'cancelled' })
                      }
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <div className="crm-followup-create">
              <label className="flex flex-1 flex-col gap-2">
                {t('newTask')}
                <select
                  className="crm-followup-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as FollowupKind)}
                >
                  {FOLLOWUP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void mutate('POST', { kind })}
              >
                <Plus size={15} aria-hidden="true" />
                {t('create')}
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
