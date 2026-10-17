'use client';
import { useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Tag } from '@/types';
import { NO_TAG } from '@/lib/pipelines/deal-views';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

export function CustomerTagPicker({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('Pipelines.explorer');
  const c = useTranslations('Pipelines.smartCard');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = [
    { id: '', name: t('allTags') },
    { id: NO_TAG, name: t('untagged') },
    ...tags,
  ];
  const matches = options.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        aria-label={t('customerTag')}
        className="crm-tag-picker-trigger"
      >
        <span className="truncate">
          {options.find((tag) => tag.id === value)?.name || t('allTags')}
        </span>
        <ChevronDown className="size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(360px,calc(100vw-32px))] p-3"
      >
        <div className="relative">
          <Search className="text-muted-foreground absolute start-3 top-3 size-4" />
          <Input
            autoFocus
            aria-label={c('findTag')}
            placeholder={c('findTag')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 ps-9"
          />
        </div>
        <div
          className="max-h-64 overflow-y-auto"
          role="group"
          aria-label={t('customerTag')}
        >
          {matches.map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-pressed={tag.id === value}
              onClick={() => {
                onChange(tag.id);
                setOpen(false);
                setQuery('');
              }}
              className="hover:bg-muted focus-visible:outline-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start text-sm focus-visible:outline-2"
            >
              <span className="flex items-center gap-2">
                {'color' in tag && typeof tag.color === 'string' && (
                  <i
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                )}
                {tag.name}
              </span>
              {tag.id === value && (
                <Check className="text-primary size-4 shrink-0" />
              )}
            </button>
          ))}
          {!matches.length && (
            <p className="text-muted-foreground p-4 text-sm">{c('noTags')}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
