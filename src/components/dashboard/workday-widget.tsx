'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Clock3, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { normalizeTimezone, type BusinessHours } from '@/lib/ai/business-hours';
import { getWorkdayCountdown } from '@/lib/dashboard/workday';
import styles from './workday-widget.module.css';
import { PixelWorkdayBuddy, type Buddy } from './workday-buddies';

export function WorkdayWidget() {
  const t = useTranslations('Dashboard.workday');
  const locale = useLocale();
  const { accountId, user } = useAuth();
  const storageKey =
    accountId && user ? `wacrm:workday-buddy:${accountId}:${user.id}` : null;
  const [preference, setPreference] = useState<{
    key: string | null;
    buddy: Buddy;
  }>({ key: null, buddy: 'cat' });
  const buddy = preference.key === storageKey ? preference.buddy : 'cat';
  const borderLight = useRef<HTMLSpanElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [schedule, setSchedule] = useState<{
    accountId: string;
    hours: BusinessHours | null;
    timezone: string;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!storageKey) return;
    const load = () => {
      let buddy: Buddy = 'cat';
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === 'cat' || saved === 'robot' || saved === 'coffee')
          buddy = saved;
      } catch {
        /* The switcher still works when browser storage is blocked. */
      }
      setPreference({ key: storageKey, buddy });
    };
    const timer = setTimeout(load, 0);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) load();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', onStorage);
    };
  }, [storageKey]);

  const chooseBuddy = (buddy: Buddy) => {
    setPreference({ key: storageKey, buddy });
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, buddy);
      } catch {
        /* Keep the choice for this visit. */
      }
    }
  };

  useEffect(() => {
    // Match a clock's second hand: 0 seconds at the top, 15 on the right.
    const sync = () => {
      const animation = borderLight.current?.getAnimations()[0];
      if (animation) animation.currentTime = Date.now() % 60000;
    };
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const load = async () => {
      try {
        const { data, error } = await createClient()
          .from('accounts')
          .select('business_hours, timezone')
          .eq('id', accountId)
          .single();
        if (error || !data) throw error ?? new Error('Missing account');
        if (active) {
          setSchedule({
            accountId,
            hours: data.business_hours as BusinessHours | null,
            timezone: data.timezone || 'UTC',
          });
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };
    void load();
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [accountId, revision]);

  const ready = schedule?.accountId === accountId && now;
  const countdown = ready
    ? getWorkdayCountdown(schedule.hours, schedule.timezone, now)
    : null;
  const state = failed ? 'unavailable' : (countdown?.state ?? 'loading');
  const running = !failed && (state === 'working' || state === 'upcoming');
  const remaining = countdown?.remaining ?? 0;
  const progress = countdown?.progress ?? 0;
  const format = (value: number) =>
    new Intl.NumberFormat(locale, {
      minimumIntegerDigits: 2,
      useGrouping: false,
    }).format(value);
  const units = [
    Math.floor(remaining / 3600),
    Math.floor(remaining / 60) % 60,
    remaining % 60,
  ];
  const closes =
    countdown?.closesAt && schedule
      ? new Intl.DateTimeFormat(locale, {
          timeZone: normalizeTimezone(schedule.timezone),
          hour: 'numeric',
          minute: '2-digit',
        }).format(countdown.closesAt)
      : '';

  return (
    <section className={styles.widget} aria-label={t('title')}>
      <span className={styles.borderOrbit} aria-hidden="true">
        <span ref={borderLight} className={styles.borderLight} />
      </span>
      <div className={styles.heading}>
        <Clock3 size={15} aria-hidden="true" />
        <h2>{t('title')}</h2>
        <span className={styles.status} role="status">
          {t(state)}
        </span>
      </div>
      <div className={styles.body}>
        <PixelWorkdayBuddy buddy={buddy} progress={progress} />
        <div className={styles.reading}>
          <p className={styles.caption}>
            {t(running ? 'remaining' : 'takeABreath')}
          </p>
          <div
            className={styles.timer}
            role="timer"
            aria-label={
              running
                ? t('timeRemaining', {
                    hours: units[0],
                    minutes: units[1],
                    seconds: units[2],
                  })
                : t(state)
            }
          >
            {units.map((value, index) => (
              <div key={index}>
                <strong>
                  {running || state === 'finished' ? format(value) : '—'}
                </strong>
                <span>{t(['hours', 'minutes', 'seconds'][index])}</span>
              </div>
            ))}
          </div>
          <p className={styles.closing}>
            {running ? t('closesAt', { time: closes }) : t(`${state}Hint`)}
          </p>
        </div>
      </div>
      <fieldset className={styles.buddyPicker}>
        <legend className="sr-only">{t('chooseBuddy')}</legend>
        {(['cat', 'robot', 'coffee'] as const).map((option) => (
          <label key={option} className={styles.buddyOption}>
            <input
              type="radio"
              name={`workday-buddy-${accountId}`}
              value={option}
              checked={buddy === option}
              onChange={() => chooseBuddy(option)}
              disabled={!storageKey}
            />
            <span>{t(`buddies.${option}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.footer}>
        <span>{ready ? schedule.timezone : t('accountSchedule')}</span>
        {failed ? (
          <button onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={12} aria-hidden="true" />
            {t('retry')}
          </button>
        ) : (
          <Link href="/agents">{t('businessHours')} ↗</Link>
        )}
      </div>
    </section>
  );
}
