'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DataNotice } from '@/components/workspace/data-notice';
import { MessageBubble } from './message-bubble';
import type { Message } from '@/types';

/** An explicit bounded context view, kept separate from the latest chat history. */
export function MessageSearchContext({
  conversationId,
  messageId,
  contactLabel,
  onReturn,
  onReply,
}: {
  conversationId: string;
  messageId: string;
  contactLabel: string;
  onReturn: () => void;
  onReply: (message: Message) => void;
}) {
  const t = useTranslations('Inbox.historySearch'),
    anchor = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<{
    key: string;
    messages: Message[];
    error: boolean;
    busy: boolean;
  }>({ key: '', messages: [], error: false, busy: true });
  const [attempt, setAttempt] = useState(0);
  const key = `${conversationId}:${messageId}`;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setState({ key, messages: [], error: false, busy: true });
      try {
        const response = await fetch('/api/inbox/message-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'context',
            conversationId,
            messageId,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json();
        if (!controller.signal.aborted)
          setState({
            key,
            messages: result.messages,
            error: false,
            busy: false,
          });
      } catch {
        if (!controller.signal.aborted)
          setState({ key, messages: [], error: true, busy: false });
      }
    })();
    return () => controller.abort();
  }, [conversationId, messageId, key, attempt]);
  useEffect(() => {
    if (state.key === key && !state.busy && !state.error) {
      anchor.current?.focus({ preventScroll: true });
      anchor.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [state, key]);
  const rows = state.key === key ? state.messages : [];
  return (
    <section className="space-y-4 p-4" aria-label={t('contextTitle')}>
      <div className="border-border bg-card sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h2 className="text-sm font-semibold">{t('contextTitle')}</h2>
          <p className="text-muted-foreground text-xs">{t('contextHint')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onReturn}>
          {t('returnLatest')}
        </Button>
      </div>
      {state.key !== key || state.busy ? (
        <p role="status">{t('loading')}</p>
      ) : state.error ? (
        <DataNotice
          title={t('openFailed')}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : (
        rows.map((message) => (
          <article
            key={message.id}
            ref={message.id === messageId ? anchor : undefined}
            tabIndex={message.id === messageId ? -1 : undefined}
            className={
              message.id === messageId
                ? 'ring-primary rounded-lg p-2 ring-2 focus-visible:outline-2 focus-visible:outline-offset-4'
                : ''
            }
          >
            <MessageBubble
              message={message}
              authorLabel={
                message.sender_type === 'customer'
                  ? contactLabel
                  : t(message.sender_type === 'bot' ? 'bot' : 'team')
              }
            />
            {message.id === messageId && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => onReply(message)}
              >
                {t('replyToMatch')}
              </Button>
            )}
          </article>
        ))
      )}
    </section>
  );
}
