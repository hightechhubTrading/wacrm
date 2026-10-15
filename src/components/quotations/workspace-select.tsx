'use client';

import './workspace.css';

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Option = {
  value: string;
  label: ReactNode;
  description?: string;
  tone?: string;
  disabled?: boolean;
};

// Keep field declarations readable while sharing one keyboard/RTL-aware control.
function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
        'data-description'?: string;
        'data-tone'?: string;
      }>(child)
    )
      return [];
    if (child.type === Fragment) return readOptions(child.props.children);
    if (child.type !== 'option') return [];
    return [
      {
        value: String(child.props.value ?? ''),
        label: child.props.children,
        description: child.props['data-description'],
        tone: child.props['data-tone'],
        disabled: child.props.disabled,
      },
    ];
  });
}

export function WorkspaceSelect({
  value,
  onValueChange,
  children,
  disabled,
  className = '',
  id,
  'aria-label': ariaLabel,
}: {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const locale = useLocale();
  const options = readOptions(children);
  const selected = options.find((option) => option.value === String(value));
  return (
    <Select
      value={String(value)}
      items={options.map(({ value, label }) => ({ value, label }))}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={`qw-select-trigger ${selected?.tone ? `ui-tone ui-tone-${selected.tone}` : ''} ${className}`}
      >
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        positionerClassName="z-[80]"
        className={`qw-select-popup ${options.some((option) => option.description) ? 'qw-select-described' : ''}`}
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
      >
        {options.map((option) => (
          <SelectPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={`qw-select-option ${option.tone ? `ui-tone-${option.tone}` : ''}`}
          >
            <div>
              <SelectPrimitive.ItemText>
                {option.label}
              </SelectPrimitive.ItemText>
              {option.description && <small>{option.description}</small>}
            </div>
            <SelectPrimitive.ItemIndicator className="qw-select-check">
              <Check size={16} />
            </SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>
        ))}
      </SelectContent>
    </Select>
  );
}
