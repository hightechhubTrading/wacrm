'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowUpRight,
  MessageSquare,
  CalendarDays,
  CheckCheck,
  Inbox,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { createClient } from '@/lib/supabase/client';
import {
  loadAgenda,
  type AgendaData,
  type AgendaTask,
} from '@/lib/dashboard/agenda';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
export function Agenda() {
  const t = useTranslations('Dashboard.agenda');
  const kinds = useTranslations('Inbox.followups.kinds');
  const locale = useLocale();
  const { user, accountId, canSendMessages } = useAuth();
  const ft = useTranslations('Inbox.followups');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { getPresence } = usePresence();
  const [data, setData] = useState<AgendaData | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user || !accountId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await loadAgenda(createClient(), accountId, user.id);
        if (!cancelled) {
          setData(next);
          setNow(Date.now());
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    const updated = () => void refresh();
    window.addEventListener('sales-followups-updated', updated);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('sales-followups-updated', updated);
    };
  }, [user, accountId, locale, revision]);
  async function takeTask(task: AgendaTask) {
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
      setRevision((r) => r + 1);
      window.dispatchEvent(new Event('sales-followups-updated'));
      toast.success(t('taskTaken'));
    } catch {
      toast.error(ft('error'));
    } finally {
      setBusyTask(null);
    }
  }
  const unavailable = (
    <div className="crm-agenda-empty">
      {t('unavailable')}{' '}
      <button
        className="text-primary underline underline-offset-4"
        onClick={() => setRevision((r) => r + 1)}
      >
        {t('retry')}
      </button>
    </div>
  );
  const loading = (
    <div className="crm-agenda-empty" role="status">
      {t('loading')}
    </div>
  );
  return (
    <section className="crm-day-overview" aria-label={t('title')}>
      <div className="crm-day-overview-heading">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('actionHint')}</p>
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
        <section className="crm-agenda-panel crm-attention-panel">
          <div className="crm-panel-heading">
            <span className="crm-panel-symbol">
              <Inbox aria-hidden="true" />
            </span>
            <h2>{t('attention')}</h2>
            {data?.attentionAvailable && (
              <span className="crm-panel-count">
                {data.conversations.length.toLocaleString(locale)}
              </span>
            )}
          </div>
          <p>{t('attentionHint')}</p>
          {failed ? (
            unavailable
          ) : !data ? (
            loading
          ) : !data.attentionAvailable ? (
            unavailable
          ) : data.conversations.length ? (
            <ul>
              {data.conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    className="crm-agenda-row"
                    href={`/inbox?c=${encodeURIComponent(c.id)}`}
                  >
                    <span className="crm-agenda-avatar">
                      {(c.contact?.name || c.contact?.phone || '?').slice(0, 1)}
                    </span>
                    <span>
                      <strong className="truncate">
                        {c.contact?.name || c.contact?.phone}
                      </strong>
                      <small className="truncate">
                        {c.ai_priority_reason ||
                          c.last_message_text ||
                          t('openConversation')}
                      </small>
                    </span>
                    <ArrowUpRight className="rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="crm-agenda-empty crm-agenda-clear">
              <CheckCheck aria-hidden="true" />
              <span>{t('clear')}</span>
            </div>
          )}
          {data?.attentionAvailable && (
            <Link className="crm-agenda-brief" href="/inbox">
              <MessageSquare />
              <span>
                {data.priorityCount > 0
                  ? t('priorityCount', { count: data.priorityCount })
                  : t('unreadCount', { count: data.unreadCount })}
              </span>
              <ArrowUpRight className="ms-auto rtl:-scale-x-100" />
            </Link>
          )}
        </section>
        <section className="crm-agenda-panel crm-schedule-panel">
          <div className="crm-panel-heading">
            <span className="crm-panel-symbol">
              <CalendarDays aria-hidden="true" />
            </span>
            <h2>{t('followups')}</h2>
            {data?.tasksAvailable && (
              <span className="crm-panel-count">
                {data.taskCount.toLocaleString(locale)}
              </span>
            )}
          </div>
          <p>{t('followupsHint')}</p>
          {failed ? (
            unavailable
          ) : !data ? (
            loading
          ) : !data.tasksAvailable ? (
            unavailable
          ) : data.tasks.length ? (
            <ul>
              {data.tasks.map((task) => (
                <li key={task.id} className="crm-agenda-task">
                  <Link
                    className="crm-agenda-row"
                    href={`/inbox?c=${encodeURIComponent(task.conversation_id)}&followup=${encodeURIComponent(task.id)}`}
                  >
                    <span className="crm-agenda-avatar">
                      <CalendarDays />
                    </span>
                    <span>
                      <strong>
                        {kinds(task.kind)}
                        <span
                          className="crm-agenda-task-status"
                          data-overdue={
                            Date.parse(task.due_at) < now || undefined
                          }
                        >
                          {Date.parse(task.due_at) < now
                            ? ft('overdue')
                            : ft(`statuses.${task.status}`)}
                        </span>
                      </strong>
                      <small>
                        {task.conversation?.contact?.name ||
                          task.conversation?.contact?.phone}{' '}
                        ·{' '}
                        {task.due_at
                          ? new Intl.DateTimeFormat(locale, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            }).format(new Date(task.due_at))
                          : t('unscheduled')}
                      </small>
                    </span>
                    <ArrowUpRight className="rtl:-scale-x-100" />
                  </Link>
                  <div className="crm-agenda-task-actions">
                    {canSendMessages &&
                      task.status === 'open' &&
                      (!task.owner_id || task.owner_id === user?.id) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyTask !== null}
                          onClick={() => void takeTask(task)}
                        >
                          {busyTask === task.id ? t('saving') : ft('take')}
                        </Button>
                      )}
                    <Link
                      href={`/inbox?c=${encodeURIComponent(task.conversation_id)}&followup=${encodeURIComponent(task.id)}`}
                      className="crm-agenda-task-manage"
                    >
                      {ft('update')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="crm-agenda-empty crm-agenda-clear">
              <CalendarDays aria-hidden="true" />
              <span>{t('noFollowups')}</span>
            </div>
          )}
        </section>
      </div>
      {data?.membersAvailable && data.members.length > 0 && (
        <div className="crm-dashboard-team">
          <span>{t('team')}</span>
          {data.members.map((member) => {
            const status = getPresence(member.user_id);
            return (
              <span key={member.user_id} className="crm-dashboard-member">
                <span className="crm-member-avatar" aria-hidden="true">
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
    </section>
  );
}
