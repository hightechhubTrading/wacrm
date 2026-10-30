'use client';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
export function BusinessTimeNote({ className }: { className?: string }) {
  const t = useTranslations('Recovery');
  return (
    <span className={cn('text-muted-foreground block text-xs', className)}>
      {t('businessTimezone')}
    </span>
  );
}
