'use client';
import { BusinessTimeNote } from '@/components/workspace/business-time-note';
import { BUSINESS_TIME_ZONE } from '@/lib/business-time';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowUpRight,
  MessageSquare,
  CalendarDays,
  CheckCheck,
  Clock3,
  CircleAlert,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { createClient } from '@/lib/supabase/client';
import {
  loadAgenda,
  type AgendaData,
  type AgendaTask,
  type AgendaWork,
} from '@/lib/dashboard/agenda';
import { Button } from '@/components/ui/button';
import { GroupWorkDialog } from '@/components/jobs/group-work';
import { toast } from 'sonner';

export function Agenda() {
  const t = useTranslations('Dashboard.agenda');
  const kinds = useTranslations('Inbox.followups.kinds');
  const ft = useTranslations('Inbox.followups');
  const jt = useTranslations('Jobs');
  const locale = useLocale();
  const { user, accountId, canSendMessages } = useAuth();
  const { getPresence } = usePresence();
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState<{
    accountId: string;
    userId: string;
    data: AgendaData;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedWork, setSelectedWork] = useState<{
    accountId: string;
    userId: string;
    work: AgendaWork;
  } | null>(null);
  const taskLock = useRef(false);
  const userId = user?.id;
  // Never display a previous account/user's rows during auth changes.
  const data =
    snapshot?.accountId === accountId && snapshot?.userId === userId
      ? snapshot.data
      : null;
  useEffect(() => {
    if (!userId || !accountId || !canSendMessages) return;
    let cancelled = false;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const next = await loadAgenda(createClient(), accountId, userId);
        if (!cancelled && current === request) {
          setSnapshot({ accountId, userId, data: next });
          setNow(Date.now());
          setFailed(false);
        }
      } catch {
        if (!cancelled && current === request) setFailed(true);
      }
    };
    const updated = () => void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('sales-followups-updated', updated);
    window.addEventListener('group-work-updated', updated);
    document.addEventListener('visibilitychange', visible);
    void refresh();
    const timer = setInterval(visible, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('sales-followups-updated', updated);
      window.removeEventListener('group-work-updated', updated);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId, accountId, canSendMessages, revision]);

  async function takeTask(task: AgendaTask) {
    if (taskLock.current) return;
    taskLock.current = true;
    setBusyTask(task.id);
    try {
      const response = await fetch(
        `/api/ai/followups/${encodeURIComponent(task.conversation_id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: task.id, status: 'acknowledged' }),
        }
      );
      if (!response.ok) throw new Error('update');
      window.dispatchEvent(new Event('sales-followups-updated'));
      toast.success(t('taskTaken'));
    } catch {
      toast.error(ft('error'));
    } finally {
      taskLock.current = false;
      setBusyTask(null);
    }
  }
  if (!canSendMessages) return null;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: BUSINESS_TIME_ZONE,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  const unavailable = (
    <div className="crm-agenda-empty" role="status">
      {t('unavailable')}{' '}
      <button
        className="crm-today-retry text-primary underline underline-offset-4"
        onClick={() => setRevision((r) => r + 1)}
      >
        {t('retry')}
      </button>
    </div>
  );
  function content(
    available: boolean | undefined,
    rows: ReactNode,
    count: number | undefined,
    empty: string
  ) {
    if (failed) return unavailable;
    if (!data)
      return (
        <div className="crm-agenda-empty" role="status">
          {t('loading')}
        </div>
      );
    if (!available) return unavailable;
    return count ? (
      rows
    ) : (
      <div className="crm-agenda-empty crm-agenda-clear">
        <CheckCheck aria-hidden />
        <span>{empty}</span>
      </div>
    );
  }
  function panel(
    key: string,
    icon: ReactNode,
    title: string,
    hint: string,
    available: boolean | undefined,
    count: number | undefined,
    shown: number,
    body: ReactNode,
    href: string,
    link: string
  ) {
    return (
      <section
        className={`crm-agenda-panel crm-today-panel crm-today-${key}`}
        aria-labelledby={`today-${key}`}
      >
        <div className="crm-panel-heading">
          <span className="crm-panel-symbol">{icon}</span>
          <h3 id={`today-${key}`}>{title}</h3>
          {!failed && available && (
            <span className="crm-panel-count">
              {count?.toLocaleString(locale)}
            </span>
          )}
        </div>
        <p>{hint}</p>
        {body}
        {!failed && available && count !== undefined && count > shown && (
          <p className="crm-today-more">{t('showing', { shown, count })}</p>
        )}
        <Link href={href} className="crm-agenda-brief">
          <span>{link}</span>
          <ArrowUpRight className="ms-auto rtl:-scale-x-100" aria-hidden />
        </Link>
      </section>
    );
  }
  function workRows(rows: AgendaWork[]) {
    return (
      <ul>
        {rows.map((work) => (
          <li key={work.id}>
            <button
              type="button"
              className="crm-agenda-row crm-today-work"
              onClick={() =>
                setSelectedWork({
                  accountId: accountId!,
                  userId: userId!,
                  work,
                })
              }
            >
              <span className="crm-agenda-avatar">
                {work.status === 'blocked' ? (
                  <CircleAlert aria-hidden />
                ) : (
                  <Clock3 aria-hidden />
                )}
              </span>
              <span>
                <strong dir="auto">{work.deal.title}</strong>
                <small dir="auto">
                  HTH-{work.reference} · {jt(`kinds.${work.kind}`)}
                </small>
                <small>{jt(`statuses.${work.status}`)}</small>
                {work.due_at && (
                  <small
                    data-overdue={Date.parse(work.due_at) < now || undefined}
                  >
                    {t('requested', { date: date(work.due_at) })}
                    {Date.parse(work.due_at) < now ? ` · ${jt('overdue')}` : ''}
                  </small>
                )}
                {work.responsible && (
                  <small dir="auto">
                    {t('responsible')}: {work.responsible}
                  </small>
                )}
              </span>
              <ArrowUpRight className="rtl:-scale-x-100" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section
      className="crm-day-overview crm-sales-today"
      aria-label={t('title')}
    >
      <div className="crm-day-overview-heading">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('actionHint')}</p>
          <BusinessTimeNote />
        </div>
        <Link href="/inbox" className="text-primary text-sm">
          {t('openInbox')}{' '}
          <ArrowUpRight
            size={14}
            className="inline rtl:-scale-x-100"
            aria-hidden
          />
        </Link>
      </div>
      <div className="crm-agenda-grid">
        {panel(
          'replies',
          <MessageSquare aria-hidden />,
          t('replies'),
          t('repliesHint'),
          data?.repliesAvailable,
          data?.replyCount,
          data?.replies.length ?? 0,
          content(
            data?.repliesAvailable,
            <ul>
              {data?.replies.map((c) => (
                <li key={c.id}>
                  <Link
                    className="crm-agenda-row"
                    href={`/inbox?c=${encodeURIComponent(c.id)}`}
                  >
                    <span className="crm-agenda-avatar">
                      <MessageSquare aria-hidden />
                    </span>
                    <span>
                      <strong dir="auto">
                        {c.contact?.name ||
                          c.contact?.phone ||
                          t('openConversation')}
                      </strong>
                      <small className="crm-today-preview" dir="auto">
                        {c.last_message_text || t('openConversation')}
                      </small>
                      <small>{date(c.last_message_at)}</small>
                    </span>
                    <ArrowUpRight className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>,
            data?.replyCount,
            t('noReplies')
          ),
          '/inbox',
          t('openInbox')
        )}
        {panel(
          'followups',
          <CalendarDays aria-hidden />,
          t('followups'),
          t('followupsHint'),
          data?.tasksAvailable,
          data?.taskCount,
          data?.tasks.length ?? 0,
          content(
            data?.tasksAvailable,
            <ul>
              {data?.tasks.map((task) => (
                <li key={task.id} className="crm-agenda-task">
                  <Link
                    className="crm-agenda-row"
                    href={`/inbox?c=${encodeURIComponent(task.conversation_id)}&followup=${encodeURIComponent(task.id)}`}
                  >
                    <span className="crm-agenda-avatar">
                      <CalendarDays aria-hidden />
                    </span>
                    <span>
                      <strong>{kinds(task.kind)}</strong>
                      <small dir="auto">
                        {task.conversation?.contact?.name ||
                          task.conversation?.contact?.phone ||
                          t('openConversation')}
                      </small>
                      <small
                        data-overdue={
                          Date.parse(task.due_at) < now || undefined
                        }
                      >
                        {date(task.due_at)} ·{' '}
                        {Date.parse(task.due_at) < now
                          ? ft('overdue')
                          : ft(`statuses.${task.status}`)}
                      </small>
                    </span>
                    <ArrowUpRight className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                  <div className="crm-agenda-task-actions">
                    {task.status === 'open' &&
                      (!task.owner_id || task.owner_id === userId) && (
                        <Button
                          className="min-h-11"
                          variant="outline"
                          disabled={busyTask !== null}
                          onClick={() => void takeTask(task)}
                        >
                          {busyTask === task.id ? t('saving') : ft('take')}
                        </Button>
                      )}
                    <Link
                      className="crm-agenda-task-manage"
                      href={`/inbox?c=${encodeURIComponent(task.conversation_id)}&followup=${encodeURIComponent(task.id)}`}
                    >
                      {ft('update')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>,
            data?.taskCount,
            t('noFollowups')
          ),
          '/inbox',
          t('openInbox')
        )}
        {panel(
          'blocked',
          <CircleAlert aria-hidden />,
          t('blocked'),
          t('blockedHint'),
          data?.blockedAvailable,
          data?.blockedCount,
          data?.blocked.length ?? 0,
          content(
            data?.blockedAvailable,
            workRows(data?.blocked ?? []),
            data?.blockedCount,
            t('noBlocked')
          ),
          '/pipelines#waiting-work',
          t('openWork')
        )}
        {panel(
          'waiting',
          <Clock3 aria-hidden />,
          t('waiting'),
          t('waitingHint'),
          data?.waitingAvailable,
          data?.waitingCount,
          data?.waiting.length ?? 0,
          content(
            data?.waitingAvailable,
            workRows(data?.waiting ?? []),
            data?.waitingCount,
            t('noWaiting')
          ),
          '/pipelines#waiting-work',
          t('openWork')
        )}
      </div>
      {data?.membersAvailable && data.members.length > 0 && (
        <div className="crm-dashboard-team">
          <span>{t('team')}</span>
          {data.members.map((member) => {
            const status = getPresence(member.user_id);
            return (
              <span key={member.user_id} className="crm-dashboard-member">
                <span className="crm-member-avatar" aria-hidden>
                  {member.full_name?.slice(0, 1) || '?'}
                </span>
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${status === 'online' ? 'bg-success' : status === 'away' ? 'bg-warning' : 'bg-muted-foreground'}`}
                />
                {member.full_name}
                <span className="sr-only">{t(status)}</span>
              </span>
            );
          })}
        </div>
      )}
      {selectedWork?.accountId === accountId &&
        selectedWork?.userId === userId && (
          <GroupWorkDialog
            key={selectedWork.work.id}
            dealId={selectedWork.work.deal_id}
            initialKind={selectedWork.work.kind}
            initialWorkId={selectedWork.work.id}
            onClose={() => setSelectedWork(null)}
          />
        )}
    </section>
  );
}
