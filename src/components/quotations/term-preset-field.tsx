'use client';

import { useId, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { termChoices, termKey } from '@/lib/quotations/term-presets';

/** Existing quote text is never replaced merely by loading available presets. */
export function TermPresetField({
  label,
  value,
  options,
  disabled,
  onChange,
  optional = false,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  const id = useId(),
    ar = useLocale() === 'ar';
  const [editing, setEditing] = useState(false);
  const choices = termChoices([...options, value]);
  const selected = choices.findIndex((s) => termKey(s) === termKey(value));
  return (
    <div className="qp-term-preset">
      <label htmlFor={id}>{label}</label>
      <div className="qw-inline">
        <select
          dir="auto"
          id={id}
          value={editing ? 'custom' : selected < 0 ? '' : String(selected)}
          disabled={disabled}
          onChange={(e) => {
            const key = e.target.value;
            if (key === 'custom') {
              setEditing(true);
              return;
            }
            setEditing(false);
            onChange(key === '' ? '' : choices[Number(key)]);
          }}
        >
          <option value="">
            {optional
              ? ar
                ? 'بدون ملاحظات إضافية'
                : 'None'
              : ar
                ? 'اختر من الشروط المسجلة'
                : 'Choose recorded terms'}
          </option>
          {choices.map((s, i) => (
            <option dir="auto" key={i} value={String(i)}>
              {s.replaceAll('\n', ' · ')}
            </option>
          ))}
          <option value="custom">
            {ar ? 'مخصص / إضافة نص' : 'Custom / add text'}
          </option>
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          {ar ? (editing ? 'تم' : 'تعديل') : editing ? 'Done' : 'Edit'}
        </Button>
      </div>
      {editing && (
        <textarea
          aria-label={`${label} — ${ar ? 'نص مخصص' : 'custom text'}`}
          rows={3}
          dir="auto"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
