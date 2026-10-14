'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, MessageSquare, CalendarDays } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { createClient } from '@/lib/supabase/client';
import { loadAgenda, type AgendaData } from '@/lib/dashboard/agenda';
export function Agenda() {
  const t = useTranslations('Dashboard.agenda');
  const kinds = useTranslations('Inbox.followups.kinds');
  const locale = useLocale();
  const { user, profile, accountId } = useAuth();
  const { getPresence } = usePresence();
  const [data, setData] = useState<AgendaData | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [today, setToday] = useState('');
  useEffect(() => {
    if (!user || !accountId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await loadAgenda(createClient(), accountId, user.id);
        if (!cancelled) {
          setData(next);
          setFailed(false);
          setToday(
            new Intl.DateTimeFormat(locale, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }).format(new Date())
          );
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, accountId, locale, revision]);
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
  const name = profile?.full_name?.split(' ')[0];
  return (
    <section aria-label={t('title')}>
      <div className="crm-agenda-heading">
        <div>
          <h1>{name ? t('greeting', { name }) : t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <time className="crm-agenda-date">{today}</time>
      </div>
      <div className="crm-agenda-grid">
        <section className="crm-agenda-panel crm-attention-panel">
          <h2>{t('attention')}</h2>
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
            <div className="crm-agenda-empty">{t('clear')}</div>
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
          <h2>{t('followups')}</h2>
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
                <li key={task.id}>
                  <Link
                    className="crm-agenda-row"
                    href={`/inbox?c=${encodeURIComponent(task.conversation_id)}&followup=${encodeURIComponent(task.id)}`}
                  >
                    <span className="crm-agenda-avatar">
                      <CalendarDays />
                    </span>
                    <span>
                      <strong>{kinds(task.kind)}</strong>
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
                </li>
              ))}
            </ul>
          ) : (
            <div className="crm-agenda-empty">{t('noFollowups')}</div>
          )}
        </section>
      </div>
      {data?.membersAvailable && data.members.length > 0 && (
        <div className="text-muted-foreground mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 px-1 text-xs">
          <span>{t('team')}</span>
          {data.members.map((member) => {
            const status = getPresence(member.user_id);
            return (
              <span
                key={member.user_id}
                className="inline-flex items-center gap-2"
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${status === 'online' ? 'bg-emerald-500' : status === 'away' ? 'bg-amber-500' : 'bg-muted-foreground'}`}
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
