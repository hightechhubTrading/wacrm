'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { QuotationDatePicker } from '@/components/quotations/quotation-date-picker';
import { BusinessTimeNote } from '@/components/workspace/business-time-note';
import {
  businessDateTimeValue,
  businessDayBoundary,
} from '@/lib/business-time';

export function FollowupSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId(),
    locale = useLocale();
  return (
    <div className="crm-followup-field">
      <label htmlFor={id}>{label}</label>
      <Select
        value={value}
        items={options}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} aria-label={label} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          className="max-w-[calc(100vw-2rem)]"
        >
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Shortcuts select a Qatar wall-clock value; the existing action still submits it explicitly. */
export function FollowupDateTimeField({
  label,
  value,
  onChange,
  disabled,
  future = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  future?: boolean;
}) {
  const t = useTranslations('Inbox.followups');
  const day = value.slice(0, 10),
    time = value.slice(11, 16);
  function quick(offset: number) {
    const now = new Date();
    const today = businessDateTimeValue(now);
    const next = businessDateTimeValue(new Date(now.getTime() + 30 * 60000));
    const todayValue = future
      ? today.slice(0, 10) +
        'T' +
        (next.slice(0, 10) === today.slice(0, 10)
          ? next.slice(11, 16)
          : '23:59')
      : today;
    onChange(
      offset === 0
        ? todayValue
        : businessDateTimeValue(businessDayBoundary(now, offset)).slice(0, 10) +
            'T' +
            (time || today.slice(11, 16))
    );
  }
  return (
    <fieldset className="crm-followup-date">
      <legend>{label}</legend>
      <div className="crm-followup-date-shortcuts">
        {[
          ['today', 0],
          ['tomorrow', 1],
          ['nextWeek', 7],
        ].map(([key, offset]) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => quick(Number(offset))}
          >
            {t(String(key))}
          </Button>
        ))}
      </div>
      <div className="crm-followup-date-inputs">
        <QuotationDatePicker
          aria-label={label}
          showValidityShortcuts={false}
          value={day}
          disabled={disabled}
          onChange={(date) =>
            onChange(
              date
                ? date +
                    'T' +
                    (time || businessDateTimeValue(new Date()).slice(11, 16))
                : ''
            )
          }
        />
        <Input
          aria-label={label + ' — ' + t('time')}
          type="time"
          value={time}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              (day || businessDateTimeValue(new Date()).slice(0, 10)) +
                'T' +
                e.target.value
            )
          }
        />
      </div>
      <div className="crm-followup-date-note">
        <BusinessTimeNote />
        {value && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange('')}
          >
            {t('clearDate')}
          </button>
        )}
      </div>
    </fieldset>
  );
}
