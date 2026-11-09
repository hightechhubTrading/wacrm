'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Clock3 } from 'lucide-react';
import { QuotationDatePicker } from '@/components/quotations/quotation-date-picker';
import { WorkspaceSelect } from '@/components/quotations/workspace-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  businessDateTimeToIso,
  businessDateTimeValue,
  businessDayKey,
  formatBusinessDate,
} from '@/lib/business-time';
import {
  dayInstant,
  overlaps,
  shiftDay,
  type Appointment,
  type BookingSelection,
} from '@/lib/jobs/appointments';

export function AppointmentFields({
  initial,
  onChange,
  disabled = false,
}: {
  initial?: Pick<Appointment, 'id' | 'starts_at' | 'ends_at'>;
  onChange: (selection: BookingSelection) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Jobs');
  const locale = useLocale();
  const fieldId = useId();
  const [now, setNow] = useState(Date.now);
  const [day, setDay] = useState(() =>
    initial ? businessDayKey(initial.starts_at) : businessDayKey(new Date())
  );
  const [time, setTime] = useState(() =>
    initial ? businessDateTimeValue(initial.starts_at).slice(11) : ''
  );
  const [minutes, setMinutes] = useState(() =>
    initial
      ? (Date.parse(initial.ends_at) - Date.parse(initial.starts_at)) / 60000
      : 60
  );
  const [calendar, setCalendar] = useState<{
    key: string;
    busy: Appointment[];
    failed: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const key = `${day}/${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    const from = dayInstant(day),
      to = dayInstant(shiftDay(day, 2));
    if (!from || !to) return;
    fetch(`/api/jobs/appointments?${new URLSearchParams({ from, to })}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('calendar');
        return res.json();
      })
      .then((body) => {
        if (
          !Array.isArray(body.appointments) ||
          body.appointments.some(
            (a: Appointment) =>
              !a ||
              typeof a.id !== 'string' ||
              !['reserved', 'completed', 'cancelled'].includes(a.status) ||
              !Number.isFinite(Date.parse(a.starts_at)) ||
              !Number.isFinite(Date.parse(a.ends_at)) ||
              Date.parse(a.ends_at) <= Date.parse(a.starts_at)
          )
        )
          throw new Error('calendar');
        if (!controller.signal.aborted)
          setCalendar({ key, busy: body.appointments, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCalendar({ key, busy: [], failed: true });
      });
    return () => controller.abort();
  }, [day, key]);
  useEffect(() => {
    const refresh = () => {
      setNow(Date.now());
      setReload((n) => n + 1);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('group-work-updated', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('group-work-updated', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const loaded = calendar?.key === key && !calendar.failed;
  const validDuration =
    Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440;
  const starts_at = time ? (businessDateTimeToIso(`${day}T${time}`) ?? '') : '';
  const ends_at =
    starts_at && validDuration
      ? new Date(Date.parse(starts_at) + minutes * 60000).toISOString()
      : '';
  const free = (start: string, end: string) =>
    Date.parse(start) > now &&
    !(calendar?.busy ?? []).some(
      (busy) => busy.id !== initial?.id && overlaps(start, end, busy)
    );
  const available = Boolean(
    loaded && starts_at && ends_at && free(starts_at, ends_at)
  );
  useEffect(() => {
    onChange({ starts_at, ends_at, available });
  }, [starts_at, ends_at, available, onChange]);
  const times = Array.from({ length: 96 }, (_, index) => {
    const value = `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`;
    const start = businessDateTimeToIso(`${day}T${value}`)!;
    const end = new Date(
      Date.parse(start) + (validDuration ? minutes : 60) * 60000
    ).toISOString();
    return { value, disabled: !loaded || !validDuration || !free(start, end) };
  });
  return (
    <section
      className="border-border bg-background space-y-3 rounded-lg border p-3"
      aria-label={t('appointment')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <CalendarDays className="text-foreground size-4" aria-hidden />
          {t('appointment')}
        </span>
        <Link
          href="/calendar"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-4"
        >
          {t('viewCalendar')}
        </Link>
      </div>
      <p className="text-muted-foreground text-xs">{t('calendarCapacity')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label>{t('appointmentDate')}</Label>
          <QuotationDatePicker
            value={day}
            onChange={setDay}
            disabled={disabled}
            showValidityShortcuts={false}
            aria-label={t('appointmentDate')}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${fieldId}-time`}>{t('startTime')}</Label>
          <WorkspaceSelect
            id={`${fieldId}-time`}
            aria-label={t('startTime')}
            value={time}
            onValueChange={setTime}
            disabled={disabled || !loaded}
            className="w-full"
          >
            <option value="">{t('chooseTime')}</option>
            {times.map((slot) => (
              <option
                key={slot.value}
                value={slot.value}
                disabled={slot.disabled}
              >
                {slot.value}
                {slot.disabled ? ` · ${t('unavailable')}` : ''}
              </option>
            ))}
          </WorkspaceSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-duration`}>{t('duration')}</Label>
          <Input
            id={`${fieldId}-duration`}
            type="number"
            min={15}
            max={1440}
            step={15}
            value={Number.isNaN(minutes) ? '' : minutes}
            onChange={(event) => setMinutes(event.target.valueAsNumber)}
            disabled={disabled}
            aria-invalid={!validDuration}
          />
        </div>
      </div>
      <div
        className={`flex items-start gap-2 text-sm ${available ? 'text-success' : 'text-muted-foreground'}`}
        role="status"
        aria-live="polite"
      >
        <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {calendar?.key === key && calendar.failed
            ? t('calendarFailed')
            : !loaded
              ? t('checkingCalendar')
              : !validDuration
                ? t('invalidDuration')
                : !time
                  ? t('chooseTime')
                  : available
                    ? t('slotAvailable', {
                        end: formatBusinessDate(ends_at, locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: 'numeric',
                          month: 'short',
                        }),
                      })
                    : t('slotBusy')}
        </span>
      </div>
      {calendar?.key === key && calendar.failed && (
        <button
          type="button"
          className="text-primary min-h-11 text-sm underline"
          onClick={() => setReload((n) => n + 1)}
        >
          {t('reload')}
        </button>
      )}
      <p className="text-muted-foreground text-xs">{t('reservationHint')}</p>
    </section>
  );
}
