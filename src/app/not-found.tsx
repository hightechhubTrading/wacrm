import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('Recovery');
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6"
    >
      <p className="text-muted-foreground text-sm">404</p>
      <h1 className="text-2xl font-semibold">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('notFoundHint')}
      </p>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href="/dashboard"
          className="text-primary rounded-sm underline underline-offset-4 focus-visible:outline-2"
        >
          {t('backToToday')}
        </Link>
        <Link
          href="/inbox"
          className="text-primary rounded-sm underline underline-offset-4 focus-visible:outline-2"
        >
          {t('openInbox')}
        </Link>
      </div>
    </main>
  );
}
