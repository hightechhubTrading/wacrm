'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useBrowserOnline } from '@/hooks/use-browser-online';
import { Button } from '@/components/ui/button';
import { WifiOff } from 'lucide-react';
import { BUSINESS_TIME_ZONE } from '@/lib/business-time';

export function ConnectionNotice({
  connected,
  lastConnectedAt,
  lastSynchronizedAt,
  onRetry,
}: {
  connected: boolean;
  lastConnectedAt: number | null;
  lastSynchronizedAt?: number | null;
  onRetry: () => void;
}) {
  const online = useBrowserOnline();
  const t = useTranslations('Inbox.connection');
  const locale = useLocale();
  const [showDelay, setShowDelay] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowDelay(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  if (online && connected) return null;
  if (online && !lastConnectedAt && !showDelay) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-warning/20 bg-warning/10 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"
    >
      <WifiOff className="text-warning size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        <p>{t(online ? 'disconnected' : 'offline')}</p>
        {lastConnectedAt && (
          <p className="text-muted-foreground">
            {t('lastConnected', {
              time: new Intl.DateTimeFormat(locale, {
                hour: 'numeric',
                minute: '2-digit',
                timeZone: BUSINESS_TIME_ZONE,
              }).format(lastConnectedAt),
            })}
          </p>
        )}
        {lastSynchronizedAt && (
          <p className="text-muted-foreground">
            {t('lastSynchronized', {
              time: new Intl.DateTimeFormat(locale, {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: BUSINESS_TIME_ZONE,
              }).format(lastSynchronizedAt),
            })}
          </p>
        )}
      </div>
      <Button
        className="min-h-11"
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={!online}
      >
        {t('retry')}
      </Button>
    </div>
  );
}
