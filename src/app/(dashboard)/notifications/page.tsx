'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { createReconciler } from '@/lib/notifications/reconcile';
import { PageIdentity } from '@/components/workspace/page-identity';
import { Button } from '@/components/ui/button';
import type { Notification } from '@/types';
import { toast } from 'sonner';
import { NotificationHealth } from '@/components/notifications/health';
import { targetHref } from '@/lib/notifications/policy';
import { NotificationPreferences } from '@/components/notifications/preferences';
import { NotificationTaskActions } from '@/components/notifications/task-actions';

const PAGE = 50;
export default function NotificationsPage() {
  const { accountId, user, accountRole } = useAuth();
  const scope = `${accountId}:${user?.id}:${accountRole}`;
  // Remount all local state on identity changes; late requests only touch the old instance.
  return (
    <NotificationCenter key={scope} accountId={accountId} userId={user?.id} />
  );
}
function NotificationCenter({
  accountId,
  userId,
}: {
  accountId: string | null;
  userId?: string;
}) {
  const t = useTranslations('NotificationCenter');
  const workspace = useTranslations('Workspace');
  const locale = useLocale();
  const router = useRouter();
  const unreadCount = useUnreadNotifications();
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState('all');
  const [cursor, setCursor] = useState<{
    created_at: string;
    id: string;
  } | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!accountId || !userId) return;
    const db = createClient();
    const sync = createReconciler(
      async () => {
        let query = db
          .from('notifications')
          .select('*')
          .eq('account_id', accountId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(PAGE + 1);
        if (cursor)
          query = query.or(
            `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
          );
        if (unreadOnly) query = query.is('read_at', null);
        if (category === 'system') query = query.eq('type', 'ai_key_invalid');
        if (category === 'followups') query = query.eq('category', 'followups');
        if (category === 'jobs') query = query.eq('category', 'jobs');
        if (category === 'attention') query = query.eq('priority', 'high');
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as Notification[];
      },
      (data) => {
        setRows(data.slice(0, PAGE));
        setMore(data.length > PAGE);
        setError(false);
      },
      () => setError(true)
    );
    refresh.current = sync.refresh;
    sync.refresh();
    const channel = db
      .channel(
        `notification-center:${accountId}:${userId}:${cursor?.id ?? 'latest'}:${unreadOnly}:${category}`
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        sync.invalidate
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') sync.refresh();
      });
    const resume = () => {
      if (document.visibilityState === 'visible') sync.refresh();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    const timer = setInterval(resume, 60_000);
    return () => {
      sync.stop();
      clearInterval(timer);
      void db.removeChannel(channel);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [accountId, userId, cursor, unreadOnly, category]);
  const markRead = useCallback(
    async (id?: string) => {
      if (!accountId || !userId) return;
      setBusy(true);
      try {
        const db = createClient();
        const result = id
          ? await db
              .from('notifications')
              .update({ read_at: new Date().toISOString() })
              .eq('id', id)
              .eq('account_id', accountId)
              .eq('user_id', userId)
              .is('read_at', null)
          : await db.rpc('mark_notifications_read', { p_account: accountId });
        if (result.error) throw result.error;
        window.dispatchEvent(new Event('notifications-changed'));
        refresh.current();
      } catch {
        toast.error(t('readFailed'));
      } finally {
        setBusy(false);
      }
    },
    [accountId, userId, t]
  );
  const open = async (row: Notification) => {
    if (row.target_kind && row.target_id) {
      const table =
        row.target_kind === 'quotation' ? 'quotations' : 'job_appointments';
      const { data, error } = await createClient()
        .from(table)
        .select('id')
        .eq('account_id', accountId!)
        .eq('id', row.target_id)
        .maybeSingle();
      if (error || !data) {
        toast.error(t('unavailable'));
        return;
      }
      const href = targetHref(row);
      if (href) router.push(href);
      return;
    }
    if (row.type === 'ai_key_invalid') {
      router.push('/agents?tab=setup');
      return;
    }
    if (!row.conversation_id) return;
    // A historical notice is never authority to open a reassigned conversation.
    const { data, error } = await createClient()
      .from('conversations')
      .select('id')
      .eq('account_id', accountId!)
      .eq('id', row.conversation_id)
      .maybeSingle();
    if (error || !data) {
      toast.error(t('unavailable'));
      return;
    }
    router.push(`/inbox?c=${data.id}`);
  };
  return (
    <div className="crm-page crm-notifications-page space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageIdentity icon={Bell}>
          <h1>{workspace('notifications')}</h1>
          <p className="text-muted-foreground text-sm">
            {workspace('notificationsHint')}
          </p>
        </PageIdentity>
        <Button
          variant="outline"
          disabled={busy || unreadCount === 0}
          onClick={() => void markRead()}
        >
          <CheckCheck className="size-4" />
          {workspace('markAllRead')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={unreadOnly ? 'default' : 'outline'}
          aria-pressed={unreadOnly}
          onClick={() => {
            setUnreadOnly((v) => !v);
            setRows(null);
            setCursor(null);
          }}
        >
          {t('unread')} ({unreadCount})
        </Button>
        <label className="flex items-center gap-2 text-sm">
          {t('filter')}
          <select
            className="border-input bg-background rounded-md border p-2"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setRows(null);
              setCursor(null);
            }}
          >
            {['all', 'attention', 'followups', 'jobs', 'system'].map(
              (value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              )
            )}
          </select>
        </label>
      </div>
      {error && (
        <div role="alert" className="flex items-center gap-3">
          <p>{t('loadFailed')}</p>
          <Button variant="outline" onClick={() => refresh.current()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {rows === null && !error && (
        <div role="status">
          <Loader2 className="size-5 animate-spin" />
          <span className="sr-only">{t('loading')}</span>
        </div>
      )}
      {rows?.length === 0 && (
        <p className="text-muted-foreground py-12 text-center">
          {workspace('emptyNotifications')}
        </p>
      )}
      {accountId && userId && (
        <NotificationPreferences accountId={accountId} userId={userId} />
      )}
      <NotificationHealth />
      <ul className="divide-border divide-y">
        {rows?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">
                {!row.read_at && (
                  <span className="text-primary me-2 text-sm">
                    {t('unread')}
                  </span>
                )}
                {row.copy_key && t.has(`eventTitles.${row.copy_key}`)
                  ? t(`eventTitles.${row.copy_key}`)
                  : row.title}
                {row.resolved_at && (
                  <span className="text-muted-foreground ms-2 text-sm">
                    {t('resolved')}
                  </span>
                )}
              </p>
              {(row.body || row.copy_key) && (
                <p className="text-muted-foreground mt-1 text-sm break-words whitespace-pre-wrap">
                  {row.copy_key && t.has(`eventBodies.${row.copy_key}`)
                    ? t(`eventBodies.${row.copy_key}`, {
                        reference: row.source_reference ?? '',
                        reason: row.body ?? '',
                      })
                    : row.body}
                </p>
              )}
              <NotificationTaskActions
                notice={row}
                onChange={() => refresh.current()}
              />
              <time
                className="text-muted-foreground mt-1 block text-xs"
                dateTime={row.created_at}
              >
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(row.created_at))}
              </time>
            </div>
            <div className="flex flex-wrap gap-2">
              {(row.conversation_id ||
                row.target_id ||
                row.type === 'ai_key_invalid') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void open(row)}
                >
                  {t('open')}
                </Button>
              )}
              {row.priority === 'high' &&
                !row.acknowledged_at &&
                !row.resolved_at && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const { error } = await createClient().rpc(
                          'acknowledge_notification',
                          { p_id: row.id }
                        );
                        if (error) throw error;
                        refresh.current();
                      } catch {
                        toast.error(t('taskFailed'));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t('acknowledged')}
                  </Button>
                )}
              {!row.read_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void markRead(row.id)}
                >
                  {t('markRead')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          variant="outline"
          onClick={() => {
            setRows(null);
            setCursor(null);
          }}
        >
          {t('latest')}
        </Button>
      )}
      {more && (
        <Button
          variant="outline"
          onClick={() =>
            setCursor(
              rows?.length
                ? {
                    created_at: rows[rows.length - 1].created_at,
                    id: rows[rows.length - 1].id,
                  }
                : null
            )
          }
        >
          {t('loadMore')}
        </Button>
      )}
    </div>
  );
}
