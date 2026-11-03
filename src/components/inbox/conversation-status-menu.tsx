'use client';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CONVERSATION_WORK_STATUSES,
  workStatusLifecycle,
  type ConversationWorkStatus,
} from '@/lib/inbox/work-status';
import type { ConversationStatus } from '@/types';
import { cn } from '@/lib/utils';
const BASIC = [
  { label: 'Open', value: 'open', color: 'text-info' },
  { label: 'Pending', value: 'pending', color: 'text-warning' },
  { label: 'Closed', value: 'closed', color: 'text-success' },
] as const;
export function ConversationStatusMenu({
  status,
  workStatus,
  disabled,
  onChange,
}: {
  status: ConversationStatus;
  workStatus?: ConversationWorkStatus | null;
  disabled?: boolean;
  onChange: (
    status: ConversationStatus,
    workStatus: ConversationWorkStatus | null
  ) => void;
}) {
  const t = useTranslations('Inbox.messageThread'),
    basic = BASIC.find((o) => o.value === status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t('status')}
        className={cn(
          'hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs',
          workStatus === 'cancelled' ? 'text-muted-foreground' : basic?.color
        )}
      >
        {workStatus
          ? t(`workStatuses.${workStatus}`)
          : basic
            ? t(`status${basic.label}`)
            : t('status')}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        {CONVERSATION_WORK_STATUSES.map((value) => (
          <DropdownMenuItem
            key={value}
            onClick={() => onChange(workStatusLifecycle(value), value)}
          >
            {t(`workStatuses.${value}`)}
            {workStatus === value && <Check size={14} className="ms-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {BASIC.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => onChange(o.value, null)}
            className={cn('text-sm', o.color)}
          >
            {t(`status${o.label}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
