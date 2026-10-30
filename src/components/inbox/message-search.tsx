'use client';
import { BUSINESS_TIME_ZONE } from '@/lib/business-time';
import { BusinessTimeNote } from '@/components/workspace/business-time-note';
import { useEffect, useRef, useState, useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { DataNotice } from '@/components/workspace/data-notice';
import {
  searchDayBoundary,
  type MessageSearchItem,
  type MessageSearchQuery,
  type SearchCursor,
} from '@/lib/inbox/message-search';

export function MessageSearch({
  activeConversationId,
  onOpenMessage,
}: {
  activeConversationId: string | null;
  onOpenMessage?: (
    conversationId: string,
    messageId: string
  ) => Promise<boolean>;
}) {
  const t = useTranslations('Inbox.historySearch'),
    locale = useLocale(),
    formId = useId();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [sender, setSender] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [onlyCurrent, setOnlyCurrent] = useState(false);
  const [items, setItems] = useState<MessageSearchItem[]>([]),
    [total, setTotal] = useState(0),
    [cursor, setCursor] = useState<SearchCursor | null>(null);
  const [applied, setApplied] = useState<MessageSearchQuery | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [validation, setValidation] = useState(''),
    [opening, setOpening] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null),
    sequence = useRef(0),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) {
      request.current?.abort();
      sequence.current++;
    }
  }, [open]);
  function changeOpen(value: boolean) {
    if (!value) {
      request.current?.abort();
      sequence.current++;
      setBusy(false);
      setOpening(null);
    }
    setOpen(value);
  }
  async function load(
    search: MessageSearchQuery,
    next: SearchCursor | null = null
  ) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++sequence.current;
    setBusy(true);
    setError(false);
    setValidation('');
    setApplied(search);
    if (!next) {
      setItems([]);
      setCursor(null);
      setTotal(0);
    }
    try {
      const response = await fetch('/api/inbox/message-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...search, cursor: next }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('unavailable');
      const result = await response.json();
      if (
        !active.current ||
        controller.signal.aborted ||
        version !== sequence.current
      )
        return;
      setItems((previous) =>
        next
          ? [
              ...new Map(
                [...previous, ...result.items].map(
                  (item: MessageSearchItem) => [item.id, item]
                )
              ).values(),
            ]
          : result.items
      );
      setTotal(result.total);
      setCursor(result.nextCursor);
    } catch {
      if (
        !controller.signal.aborted &&
        active.current &&
        version === sequence.current
      )
        setError(true);
    } finally {
      if (
        !controller.signal.aborted &&
        active.current &&
        version === sequence.current
      )
        setBusy(false);
    }
  }
  function submit() {
    const text = query.trim();
    if (text.length < 2) {
      setValidation(t('minimum'));
      return;
    }
    const start = searchDayBoundary(from),
      end = searchDayBoundary(to, true);
    if ((from && !start) || (to && !end) || (start && end && start >= end)) {
      setValidation(t('datesInvalid'));
      return;
    }
    void load({
      query: text,
      conversationId: onlyCurrent ? activeConversationId : null,
      sender: sender || null,
      from: start,
      to: end,
    });
  }
  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 w-full justify-start lg:min-h-9"
          />
        }
      >
        <Search className="size-4" />
        {t('title')}
      </SheetTrigger>
      <SheetContent
        side={locale === 'ar' ? 'left' : 'right'}
        className="w-full overflow-y-auto sm:max-w-xl"
        closeLabel={t('close')}
      >
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('hint')}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor={`${formId}-query`}>{t('query')}</Label>
              <Input
                id={`${formId}-query`}
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                aria-invalid={!!validation}
                aria-describedby={validation ? `${formId}-error` : undefined}
              />
            </div>
            <BusinessTimeNote />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`${formId}-from`}>{t('from')}</Label>
                <Input
                  id={`${formId}-from`}
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-to`}>{t('to')}</Label>
                <Input
                  id={`${formId}-to`}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-sender`}>{t('sender')}</Label>
              <select
                id={`${formId}-sender`}
                value={sender}
                onChange={(event) => setSender(event.target.value)}
                className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">{t('allSenders')}</option>
                <option value="customer">{t('customer')}</option>
                <option value="agent">{t('team')}</option>
                <option value="bot">{t('bot')}</option>
              </select>
            </div>
            {activeConversationId && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyCurrent}
                  onChange={(event) => setOnlyCurrent(event.target.checked)}
                />
                {t('onlyCurrent')}
              </label>
            )}
            {validation && (
              <p
                role="alert"
                id={`${formId}-error`}
                className="text-destructive text-sm"
              >
                {validation}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {t('search')}
            </Button>
          </form>
          {error && applied && (
            <DataNotice
              title={t('failed')}
              onRetry={() => void load(applied)}
              busy={busy}
            />
          )}
          {applied && (!busy || items.length > 0) && (
            <p role="status" className="text-muted-foreground text-sm">
              {t('results', { count: total, query: applied.query })}
            </p>
          )}
          {busy && !items.length ? (
            <div className="space-y-3" role="status" aria-label={t('loading')}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-muted h-20 animate-pulse rounded-md"
                />
              ))}
            </div>
          ) : !error && applied && !items.length ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : null}
          <ul className="divide-border divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={opening !== null || !onOpenMessage}
                  className="hover:bg-muted/50 focus-visible:ring-ring w-full rounded-sm px-1 py-4 text-start focus-visible:ring-2"
                  onClick={async () => {
                    if (!onOpenMessage) return;
                    setOpening(item.id);
                    const version = sequence.current;
                    const opened = await onOpenMessage(
                      item.conversation_id,
                      item.id
                    ).catch(() => false);
                    if (!active.current || version !== sequence.current) return;
                    setOpening(null);
                    if (opened) changeOpen(false);
                    else setValidation(t('openFailed'));
                  }}
                >
                  <span className="flex flex-wrap justify-between gap-1 text-sm font-medium">
                    <span>
                      {item.contact_name || item.contact_phone || t('customer')}
                    </span>
                    <time
                      className="text-muted-foreground text-xs"
                      dateTime={item.created_at ?? undefined}
                    >
                      {item.created_at
                        ? new Intl.DateTimeFormat(locale, {
                            timeZone: BUSINESS_TIME_ZONE,
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(item.created_at))
                        : t('dateUnknown')}
                    </time>
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {t(
                      item.sender_type === 'customer'
                        ? 'customer'
                        : item.sender_type === 'agent'
                          ? 'team'
                          : 'bot'
                    )}
                    {item.source !== 'message' ? ` · ${t('transcript')}` : ''}
                  </span>
                  <span
                    className="mt-2 block text-sm whitespace-pre-wrap"
                    dir="auto"
                  >
                    {item.excerpt.split(/(⟦[^⟧]*⟧)/g).map((part, index) =>
                      part.startsWith('⟦') && part.endsWith('⟧') ? (
                        <mark
                          key={index}
                          className="bg-warning/20 text-foreground rounded-sm"
                        >
                          {part.slice(1, -1)}
                        </mark>
                      ) : (
                        part
                      )
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => applied && void load(applied, cursor)}
            >
              {t('loadMore')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
