'use client';

import { useState } from 'react';
import { DEFAULT_LOCALE } from '@/lib/locales';
const copy = {
  en: {
    errorTitle: 'This page could not load',
    errorHint:
      'Try again. If the problem continues, return to Today and reopen your work.',
    retry: 'Try again',
    backToToday: 'Back to Today',
  },
  ar: {
    errorTitle: 'تعذّر تحميل هذه الصفحة',
    errorHint:
      'حاول مرة أخرى. إذا استمرت المشكلة، ارجع إلى صفحة اليوم وافتح عملك من جديد.',
    retry: 'حاول مرة أخرى',
    backToToday: 'العودة إلى اليوم',
  },
};

// The root provider may itself have failed. This fallback must work without it.
export default function GlobalError({
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  const [locale] = useState(() =>
    typeof document === 'undefined'
      ? DEFAULT_LOCALE
      : document.documentElement.lang === 'ar'
        ? 'ar'
        : 'en'
  );
  const t = copy[locale];
  const retry = unstable_retry ?? reset ?? (() => window.location.reload());
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui,sans-serif',
          background: '#f6f6f5',
          color: '#202321',
        }}
      >
        <title>Hightech Hub</title>
        <main style={{ maxWidth: 480, margin: '12vh auto', padding: 24 }}>
          <h1>{t.errorTitle}</h1>
          <p style={{ lineHeight: 1.7 }}>{t.errorHint}</p>
          <button
            type="button"
            onClick={retry}
            style={{ font: 'inherit', padding: '12px 20px', cursor: 'pointer' }}
          >
            {t.retry}
          </button>
          <p>
            <a href="/dashboard">{t.backToToday}</a>
          </p>
        </main>
      </body>
    </html>
  );
}
