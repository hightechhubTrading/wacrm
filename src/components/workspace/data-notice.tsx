'use client';

import { useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

/** Persistent recovery feedback, including explicitly labeled partial/stale data. */
export function DataNotice({
  title,
  hint,
  onRetry,
  busy = false,
  partial = false,
}: {
  title: string;
  hint?: string;
  onRetry: () => void;
  busy?: boolean;
  partial?: boolean;
}) {
  const t = useTranslations('Recovery');
  return (
    <Alert
      role={partial ? 'status' : 'alert'}
      className="border-border bg-card flex flex-wrap items-start gap-3 rounded-lg border p-4"
    >
      <AlertCircle
        aria-hidden="true"
        className="text-warning mt-0.5 size-4 shrink-0"
      />
      <div className="min-w-0 flex-1 text-sm">
        <AlertTitle>{title}</AlertTitle>
        {hint && (
          <AlertDescription className="mt-1 leading-relaxed">
            {hint}
          </AlertDescription>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
        {t('retry')}
      </Button>
    </Alert>
  );
}
