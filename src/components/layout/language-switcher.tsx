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

  return (
    <div
      role="group"
      aria-label={t('language')}
      aria-busy={pending}
      dir="rtl"
      className="border-border bg-background flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
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
  );
}
