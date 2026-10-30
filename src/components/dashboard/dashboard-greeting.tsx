'use client';
import { BUSINESS_TIME_ZONE } from '@/lib/business-time';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { CalendarDays, LayoutDashboard } from 'lucide-react';

export function DashboardGreeting() {
  const t = useTranslations('Dashboard.agenda');
  const page = useTranslations('Dashboard.page');
  const locale = useLocale();
  const { profile } = useAuth();
  const [today, setToday] = useState('');
  useEffect(() => {
    const update = () =>
      setToday(
        new Intl.DateTimeFormat(locale, {
          timeZone: BUSINESS_TIME_ZONE,
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }).format(new Date())
      );
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 60000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [locale]);
  const name = profile?.full_name?.split(' ')[0];
  return (
    <header className="crm-dashboard-welcome">
      <div>
        <p className="crm-dashboard-eyebrow">
          <LayoutDashboard size={13} aria-hidden="true" />
          {page('title')}
        </p>
        <h1>{name ? t('greeting', { name }) : t('title')}</h1>
        <p className="crm-dashboard-subtitle">{t('subtitle')}</p>
      </div>
      <div className="crm-dashboard-calendar">
        <CalendarDays size={16} aria-hidden="true" />
        <time>{today}</time>
      </div>
    </header>
  );
}
