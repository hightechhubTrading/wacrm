'use client';

import { WorkspaceSelect } from './workspace-select';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import './workspace.css';

export function QuotationDatePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('QuotationWorkspace');
  const locale = useLocale();
  const rtl = locale === 'ar';
  const today = parseISO(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' })
  );
  const selected = value ? parseISO(value) : null;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(selected ?? today));
  const [focused, setFocused] = useState(() => selected ?? today);
  const focusRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const label = (date: Date) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const years = Array.from(
    { length: 21 },
    (_, i) => month.getFullYear() - 10 + i
  );
  function choose(date: Date) {
    onChange(format(date, 'yyyy-MM-dd'));
    setOpen(false);
  }
  function moveMonth(delta: number) {
    const next = addMonths(month, delta);
    setMonth(next);
    setFocused(next);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    let next: Date;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(date, rtl ? 1 : -1);
        break;
      case 'ArrowRight':
        next = addDays(date, rtl ? -1 : 1);
        break;
      case 'ArrowUp':
        next = addDays(date, -7);
        break;
      case 'ArrowDown':
        next = addDays(date, 7);
        break;
      case 'Home':
        next = startOfWeek(date, { weekStartsOn: 1 });
        break;
      case 'End':
        next = addDays(startOfWeek(date, { weekStartsOn: 1 }), 6);
        break;
      case 'PageUp':
        next = addMonths(date, -1);
        break;
      case 'PageDown':
        next = addMonths(date, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    setFocused(next);
    if (!isSameMonth(next, month)) setMonth(startOfMonth(next));
    requestAnimationFrame(() =>
      gridRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-date="${format(next, 'yyyy-MM-dd')}"]`
        )
        ?.focus()
    );
  }
  return (
    <div className="qw-date-field">
      <span id="qw-validity-label">{t('validUntil')}</span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setMonth(startOfMonth(selected ?? today));
            setFocused(selected ?? today);
          }
        }}
      >
        <PopoverTrigger
          disabled={disabled}
          aria-labelledby="qw-validity-label qw-validity-value"
          className="qw-date-trigger"
        >
          <CalendarDays size={17} aria-hidden />
          <span
            id="qw-validity-value"
            className={value ? '' : 'qw-date-placeholder'}
          >
            {selected ? label(selected) : t('chooseDate')}
          </span>
          <ChevronRight
            size={14}
            className={rtl ? 'rotate-180' : ''}
            aria-hidden
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="qw-calendar"
          initialFocus={focusRef}
          dir={rtl ? 'rtl' : 'ltr'}
          aria-label={t('chooseDate')}
        >
          <div className="qw-calendar-heading">
            <button
              type="button"
              aria-label={t('previousMonth')}
              onClick={() => moveMonth(-1)}
            >
              {rtl ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
            <div>
              <WorkspaceSelect
                aria-label={t('month')}
                value={month.getMonth()}
                onValueChange={(value) => {
                  const next = new Date(month.getFullYear(), Number(value), 1);
                  setMonth(next);
                  setFocused(next);
                }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option value={i} key={i}>
                    {new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
                      month: 'long',
                    }).format(new Date(2026, i, 1))}
                  </option>
                ))}
              </WorkspaceSelect>
              <WorkspaceSelect
                aria-label={t('year')}
                value={month.getFullYear()}
                onValueChange={(value) => {
                  const next = new Date(Number(value), month.getMonth(), 1);
                  setMonth(next);
                  setFocused(next);
                }}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </WorkspaceSelect>
            </div>
            <button
              type="button"
              aria-label={t('nextMonth')}
              onClick={() => moveMonth(1)}
            >
              {rtl ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
            </button>
          </div>
          <div className="qw-calendar-weekdays" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>
                {new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
                  weekday: 'short',
                }).format(addDays(new Date(2026, 9, 12), i))}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            className="qw-calendar-days"
            role="group"
            aria-label={new Intl.DateTimeFormat(
              locale === 'ar' ? 'ar' : 'en-GB',
              {
                month: 'long',
                year: 'numeric',
              }
            ).format(month)}
          >
            {days.map((date) => {
              const focus = isSameDay(date, focused);
              const picked = !!selected && isSameDay(date, selected);
              return (
                <button
                  ref={focus ? focusRef : undefined}
                  type="button"
                  key={format(date, 'yyyy-MM-dd')}
                  data-date={format(date, 'yyyy-MM-dd')}
                  data-selected={picked || undefined}
                  data-today={isSameDay(date, today) || undefined}
                  data-outside={!isSameMonth(date, month) || undefined}
                  aria-label={label(date)}
                  aria-pressed={picked}
                  aria-current={isSameDay(date, today) ? 'date' : undefined}
                  tabIndex={focus ? 0 : -1}
                  onKeyDown={(e) => keyboard(e, date)}
                  onFocus={() => setFocused(date)}
                  onClick={() => choose(date)}
                >
                  {new Intl.NumberFormat(locale).format(date.getDate())}
                </button>
              );
            })}
          </div>
          <div className="qw-calendar-presets">
            <span>{t('validFor')}</span>
            <div>
              {[7, 15, 30].map((count) => (
                <button
                  type="button"
                  key={count}
                  onClick={() => choose(addDays(today, count))}
                >
                  {t('days', { count })}
                </button>
              ))}
            </div>
          </div>
          <div className="qw-calendar-footer">
            <button type="button" onClick={() => choose(today)}>
              {t('today')}
            </button>
            <button
              type="button"
              disabled={!value}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {t('clearDate')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
