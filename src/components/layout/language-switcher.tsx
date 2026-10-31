'use client';

import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocalePreference } from '@/hooks/use-locale-preference';
import { LOCALES } from '@/lib/locales';
import { cn } from '@/lib/utils';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocalePreference();
  const [pending, startTransition] = useTransition();
  const t = useTranslations('Settings.appearance');
  const nextLocale = LOCALES.find((item) => item.id !== locale) ?? LOCALES[0];

  return (
    <>
      <button
        type="button"
        lang={nextLocale.id}
        dir={nextLocale.dir}
        aria-label={t('useLanguage', { name: nextLocale.name })}
        title={t('useLanguage', { name: nextLocale.name })}
        disabled={pending}
        onClick={() => startTransition(() => setLocale(nextLocale.id))}
        className="border-border text-foreground hover:bg-muted focus-visible:outline-ring flex min-h-10 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait sm:hidden"
      >
        {nextLocale.name}
      </button>
      <div
        role="group"
        aria-label={t('language')}
        aria-busy={pending}
        dir="rtl"
        className="border-border bg-background hidden shrink-0 items-center gap-0.5 rounded-lg border p-0.5 sm:flex"
      >
        <Languages
          aria-hidden
          className="text-muted-foreground mx-1 hidden size-4 sm:block"
        />
        {LOCALES.map((item) => (
          <button
            key={item.id}
            type="button"
            lang={item.id}
            dir={item.dir}
            aria-label={t('useLanguage', { name: item.name })}
            aria-pressed={locale === item.id}
            disabled={pending}
            onClick={() => startTransition(() => setLocale(item.id))}
            className={cn(
              'focus-visible:outline-ring min-h-10 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait sm:px-3 sm:text-sm',
              locale === item.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {item.name}
          </button>
        ))}
      </div>
    </>
  );
}
