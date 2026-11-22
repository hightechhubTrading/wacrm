'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
const categories = ['assignments', 'attention', 'followups', 'system', 'jobs'];
export function NotificationPreferences({
  accountId,
  userId,
}: {
  accountId: string;
  userId: string;
}) {
  const t = useTranslations('NotificationCenter');
  const { accountRole } = useAuth();
  const [selected, setSelected] = useState(categories);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [quiet, setQuiet] = useState({
    start: '',
    end: '',
    timezone: 'Asia/Qatar',
  });
  const [channels, setChannels] = useState({
    foreground: true,
    sound: false,
    supervise: false,
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await createClient()
        .from('notification_preferences')
        .select('push_categories')
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setError(true);
        return;
      }
      const response = await fetch('/api/notifications/settings', {
        cache: 'no-store',
      });
      if (cancelled) return;
      if (!response.ok) {
        setError(true);
        return;
      }
      const config = await response.json();
      if (cancelled) return;
      const time = (minute: number | null) =>
        minute === null
          ? ''
          : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      setQuiet({
        start: time(config.quiet?.quiet_start ?? null),
        end: time(config.quiet?.quiet_end ?? null),
        timezone: config.quiet?.timezone ?? 'Asia/Qatar',
      });
      setChannels({
        foreground: config.foreground,
        sound: config.sound,
        supervise: config.supervise,
      });
      setSelected(data?.push_categories ?? categories);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, userId]);
  const save = async () => {
    if (Boolean(quiet.start) !== Boolean(quiet.end)) {
      toast.error(t('quietInvalid'));
      return;
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: quiet.timezone }).format();
    } catch {
      toast.error(t('quietInvalid'));
      return;
    }
    const minutes = (value: string) =>
      value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
    setBusy(true);
    try {
      const { error } = await createClient().rpc(
        'set_notification_categories',
        { p_account: accountId, p_categories: selected }
      );
      if (error) throw error;
      const response = await fetch('/api/notifications/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...channels,
          quiet: {
            start: minutes(quiet.start),
            end: minutes(quiet.end),
            timezone: quiet.timezone,
          },
        }),
      });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new Event('notification-preferences-changed'));
      toast.success(t('preferencesSaved'));
    } catch {
      toast.error(t('preferencesFailed'));
    } finally {
      setBusy(false);
    }
  };
  if (!accountRole || accountRole === 'viewer') return null;
  return (
    <details className="border-border rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        {t('pushPreferences')}
      </summary>
      <p className="text-muted-foreground my-3 text-sm">
        {t('preferencesHint')}
      </p>
      {error ? (
        <p role="alert">{t('preferencesFailed')}</p>
      ) : (
        <fieldset disabled={!loaded || busy} className="flex flex-wrap gap-4">
          <legend className="sr-only">{t('pushPreferences')}</legend>
          {categories.map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(category)}
                onChange={(e) =>
                  setSelected((values) =>
                    e.target.checked
                      ? [...values, category]
                      : values.filter((v) => v !== category)
                  )
                }
              />
              {t(category)}
            </label>
          ))}
          {(['foreground', 'sound', 'supervise'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels[key]}
                onChange={(e) =>
                  setChannels((v) => ({ ...v, [key]: e.target.checked }))
                }
              />
              {t(key)}
            </label>
          ))}
          <div className="flex w-full flex-wrap items-center gap-3">
            <label>
              {t('quietStart')}
              <input
                type="time"
                className="border-input bg-background ms-2 rounded border p-2"
                value={quiet.start}
                onChange={(e) =>
                  setQuiet((v) => ({ ...v, start: e.target.value }))
                }
              />
            </label>
            <label>
              {t('quietEnd')}
              <input
                type="time"
                className="border-input bg-background ms-2 rounded border p-2"
                value={quiet.end}
                onChange={(e) =>
                  setQuiet((v) => ({ ...v, end: e.target.value }))
                }
              />
            </label>
            <label>
              {t('timezone')}
              <input
                className="border-input bg-background ms-2 rounded border p-2"
                value={quiet.timezone}
                onChange={(e) =>
                  setQuiet((v) => ({ ...v, timezone: e.target.value }))
                }
              />
            </label>
          </div>
          <Button size="sm" onClick={() => void save()}>
            {t('save')}
          </Button>
        </fieldset>
      )}
    </details>
  );
}
