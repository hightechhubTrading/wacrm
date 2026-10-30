'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { recordReliability } from '@/lib/inbox/reliability';

export function RecoveryPanel({ retry }: { retry: () => void }) {
  const t = useTranslations('Recovery');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    recordReliability('route.failed');
    heading.current?.focus();
  }, []);
  return (
    <section
      role="alert"
      aria-labelledby="recovery-title"
      className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6 sm:py-12"
    >
      <h1
        id="recovery-title"
        ref={heading}
        tabIndex={-1}
        className="focus-visible:outline-primary text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        {t('errorTitle')}
      </h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('errorHint')}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={retry}>{t('retry')}</Button>
        <Link
          href="/dashboard"
          className="text-primary rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2"
        >
          {t('backToToday')}
        </Link>
      </div>
    </section>
  );
}
