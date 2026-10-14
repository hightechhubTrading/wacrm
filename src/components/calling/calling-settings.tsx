'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useCalling, callingFetch } from './calling-provider';

export function CallingSettings() {
  const t = useTranslations('Calling');
  const { canEditSettings } = useAuth();
  const calling = useCalling();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    callingFetch<{ enabled: boolean }>('/settings')
      .then((result) => {
        if (!cancelled) setEnabled(result.enabled);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section
      className="border-border bg-card space-y-4 rounded-xl border p-5"
      aria-label={t('title')}
    >
      <div className="flex items-center gap-2">
        <Phone className="text-primary size-4" />
        <h3 className="text-sm font-semibold">{t('title')}</h3>
      </div>
      <p className="text-muted-foreground text-sm">
        {t('settingsDescription')}
      </p>
      <p className="text-muted-foreground text-xs">{t('routingHint')}</p>
      <p className="text-muted-foreground text-xs">{t('setupHint')}</p>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <Button
        variant={enabled ? 'outline' : 'default'}
        disabled={loading || saving || !canEditSettings}
        aria-pressed={enabled}
        onClick={async () => {
          setSaving(true);
          setError('');
          try {
            const result = await callingFetch<{ enabled: boolean }>(
              '/settings',
              { enabled: !enabled }
            );
            setEnabled(result.enabled);
            await calling?.refreshSettings();
          } catch (error) {
            setError(
              error instanceof Error ? error.message : t('connectionFailed')
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {t(saving ? 'saving' : enabled ? 'disableCalling' : 'enableCalling')}
      </Button>
    </section>
  );
}
