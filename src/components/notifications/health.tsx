'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
interface Health {
  pending: number;
  failed: number;
  oldestPendingAt: string | null;
  lastSuccessAt: string | null;
  workerHealthy: boolean;
  pushPending: number;
  pushConfigured: boolean;
  policy: { escalation_enabled: boolean; escalation_minutes: number };
}
export function NotificationHealth() {
  const { accountRole } = useAuth();
  const t = useTranslations('NotificationCenter');
  const admin = accountRole === 'owner' || accountRole === 'admin';
  const [data, setData] = useState<Health | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/health', {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error();
      setData(await response.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    if (!admin) return;
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [admin, load]);
  if (!admin) return null;
  const save = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const result = await fetch('/api/notifications/health', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: data.policy.escalation_enabled,
          minutes: data.policy.escalation_minutes,
        }),
      });
      if (!result.ok) throw new Error();
      toast.success(t('preferencesSaved'));
      await load();
    } catch {
      toast.error(t('preferencesFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="border-border rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">{t('health')}</summary>
      {error ? (
        <div role="alert">
          <p>{t('loadFailed')}</p>
          <Button variant="outline" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      ) : data ? (
        <>
          <dl className="my-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [t('worker'), data.workerHealthy ? t('healthy') : t('stale')],
              [t('pending'), data.pending],
              [t('failed'), data.failed],
              [t('pushQueue'), data.pushPending],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-sm">
            {t('pushStatus')}:{' '}
            {data.pushConfigured ? t('configured') : t('notConfigured')}
          </p>
          <p className="text-muted-foreground text-sm">
            {t('lastSuccess')}:{' '}
            {data.lastSuccessAt
              ? new Date(data.lastSuccessAt).toLocaleString()
              : t('never')}
          </p>
          {data.failed > 0 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await fetch('/api/notifications/health', {
                    method: 'POST',
                  });
                  if (!r.ok) throw new Error();
                  await load();
                } catch {
                  toast.error(t('preferencesFailed'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('retryFailed')}
            </Button>
          )}
          <fieldset
            disabled={busy}
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            <legend>{t('escalation')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={data.policy.escalation_enabled}
                onChange={(e) =>
                  setData({
                    ...data,
                    policy: {
                      ...data.policy,
                      escalation_enabled: e.target.checked,
                    },
                  })
                }
              />
              {t('escalationEnabled')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              {t('delayMinutes')}
              <input
                className="border-input bg-background w-24 rounded border p-2"
                type="number"
                min={5}
                max={1440}
                value={data.policy.escalation_minutes}
                onChange={(e) =>
                  setData({
                    ...data,
                    policy: {
                      ...data.policy,
                      escalation_minutes: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <Button size="sm" onClick={() => void save()}>
              {t('save')}
            </Button>
          </fieldset>
          <p className="text-muted-foreground mt-2 text-sm">
            {t('escalationHint')}
          </p>
        </>
      ) : (
        <p role="status">{t('loading')}</p>
      )}
    </details>
  );
}
