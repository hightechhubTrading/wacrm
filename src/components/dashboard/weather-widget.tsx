'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  MapPin,
  RefreshCw,
  Sun,
  Wind,
} from 'lucide-react';
import styles from './weather-widget.module.css';

type Weather = {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    is_day: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
};

function condition(code: number) {
  if (code === 0) return { label: 'clear', Icon: Sun } as const;
  if (code < 3) return { label: 'partlyCloudy', Icon: CloudSun } as const;
  if (code === 3) return { label: 'cloudy', Icon: Cloud } as const;
  if (code === 45 || code === 48)
    return { label: 'fog', Icon: CloudFog } as const;
  if (code >= 95) return { label: 'storm', Icon: CloudLightning } as const;
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return { label: 'snow', Icon: CloudSnow } as const;
  return { label: 'rain', Icon: CloudRain } as const;
}

function WeatherScene({ code, night }: { code: number; night: boolean }) {
  const id = useId().replace(/:/g, '');
  const cloudy = code > 0;
  const rain = code >= 51 && ![71, 73, 75, 77, 85, 86].includes(code);
  return (
    <svg viewBox="0 0 280 200" className={styles.scene} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-sun`} cx="0.35" cy="0.25" r="0.8">
          <stop stopColor="#ffeac0" />
          <stop offset="0.55" stopColor="#f5bd64" />
          <stop offset="1" stopColor="#e39942" />
        </radialGradient>
        <linearGradient id={`${id}-cloud`} x1="0" y1="0" x2="0.3" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor={night ? '#b4c7dc' : '#dae6eb'} />
        </linearGradient>
        <linearGradient id={`${id}-moon`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff9df" />
          <stop offset="1" stopColor="#c8d7e5" />
        </linearGradient>
        <filter
          id={`${id}-shadow`}
          x="-40%"
          y="-40%"
          width="180%"
          height="200%"
        >
          <feDropShadow
            dx="0"
            dy="10"
            stdDeviation="10"
            floodColor="#254859"
            floodOpacity="0.12"
          />
        </filter>
      </defs>
      <circle
        cx="147"
        cy="90"
        r="79"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.07"
      />
      <circle
        cx="147"
        cy="90"
        r="61"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeDasharray="1 8"
      />
      {night ? (
        <>
          <path
            d="M175 44A48 48 0 1 0 199 111A42 42 0 0 1 175 44Z"
            fill={`url(#${id}-moon)`}
            filter={`url(#${id}-shadow)`}
          />
          <path
            d="M65 52v10m-5-5h10M222 51v8m-4-4h8M210 145v6m-3-3h6"
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="89" cy="123" r="1.5" fill="currentColor" opacity="0.35" />
        </>
      ) : (
        <circle
          cx="147"
          cy="88"
          r="43"
          fill={`url(#${id}-sun)`}
          filter={`url(#${id}-shadow)`}
        />
      )}
      {cloudy && (
        <g filter={`url(#${id}-shadow)`}>
          <path
            d="M74 140C51 140 51 111 73 109C71 86 95 80 107 99C118 73 158 81 162 106C196 99 206 140 177 140Z"
            fill={`url(#${id}-cloud)`}
          />
          <path
            d="M150 157C130 157 132 135 149 134C149 111 181 108 190 128C213 123 229 157 205 157Z"
            fill={`url(#${id}-cloud)`}
            opacity="0.88"
          />
        </g>
      )}
      {rain && (
        <path
          d="m100 153-4 9m22-9-4 9m22-9-4 9"
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function WeatherWidget() {
  const t = useTranslations('Dashboard.weather');
  const locale = useLocale();
  const [weather, setWeather] = useState<Weather | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(true);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/dashboard/weather', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!response.ok) throw new Error('Weather unavailable');
        const data: Weather = await response.json();
        if (active) {
          setWeather(data);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setRefreshing(false);
      }
    };
    void refresh();
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') void refresh();
      },
      15 * 60 * 1000
    );
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
    };
  }, [revision]);

  const current = weather?.current;
  const sky = condition(current?.weather_code ?? 0);
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

  return (
    <section
      className={styles.widget}
      data-night={current?.is_day === 0}
      aria-label={t('title')}
    >
      <div className={styles.current}>
        <div className={styles.location}>
          <MapPin size={14} aria-hidden="true" />
          {t('location')}
          <span>{t('title')}</span>
        </div>
        {current ? (
          <>
            <div className={styles.temperature}>
              {number(current.temperature_2m)}
              <span>°C</span>
            </div>
            <p className={styles.condition}>
              {t(sky.label)}
              <span>
                {' '}
                ·{' '}
                {t('feelsLike', {
                  value: number(current.apparent_temperature),
                })}
              </span>
            </p>
            <div className={styles.details}>
              <span>
                <Wind size={14} aria-hidden="true" />
                {t('wind', { value: number(current.wind_speed_10m) })}
              </span>
              <span>
                <Droplets size={14} aria-hidden="true" />
                {t('humidity', { value: number(current.relative_humidity_2m) })}
              </span>
            </div>
          </>
        ) : (
          <p className={styles.placeholder} role="status">
            {t(failed ? 'unavailable' : 'loading')}
          </p>
        )}
      </div>
      <div className={styles.sky} aria-hidden="true">
        <div className={styles.halo} />
        {current && (
          <WeatherScene
            key={`${current.is_day}-${sky.label}`}
            code={current.weather_code}
            night={current.is_day === 0}
          />
        )}
      </div>
      <div className={styles.outlook}>
        <div className={styles.forecastHeading}>
          <h2>{t('outlook')}</h2>
          <button
            type="button"
            disabled={refreshing}
            aria-label={t('refresh')}
            onClick={() => {
              setRefreshing(true);
              setRevision((r) => r + 1);
            }}
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.forecast}>
          {weather ? (
            weather.daily.time.slice(1).map((day, i) => {
              const index = i + 1;
              const forecast = condition(weather.daily.weather_code[index]);
              return (
                <div key={day} className={styles.day}>
                  <time dateTime={day}>
                    {new Intl.DateTimeFormat(locale, {
                      weekday: 'short',
                      timeZone: 'Asia/Qatar',
                    }).format(new Date(`${day}T12:00:00+03:00`))}
                  </time>
                  <forecast.Icon
                    size={22}
                    strokeWidth={1.5}
                    aria-label={t(forecast.label)}
                  />
                  <div>
                    {number(weather.daily.temperature_2m_max[index])}°{' '}
                    <span>
                      {number(weather.daily.temperature_2m_min[index])}°
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className={styles.placeholder}>{t('forecastHint')}</p>
          )}
        </div>
        <div className={styles.footer}>
          <span role="status">
            {failed
              ? t(weather ? 'stale' : 'unavailable')
              : refreshing
                ? t('loading')
                : t('updated')}
          </span>
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo ↗
          </a>
        </div>
      </div>
    </section>
  );
}
