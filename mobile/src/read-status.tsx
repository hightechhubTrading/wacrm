import { useEffect, useState } from 'react';
import { useForeground } from './use-foreground';
import { mobileApi, MobileApiError } from './mobile-api';
import type { Conversation } from './workspace-ui';
export function ReadStatus({
  conversation,
  enabled,
  onRead,
  onConflict,
}: {
  conversation: Conversation;
  enabled: boolean;
  onRead: (snapshot: Conversation) => void;
  onConflict: () => void;
}) {
  const foreground = useForeground();
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const { id, unread_count, last_message_at } = conversation;
  useEffect(() => {
    if (
      !enabled ||
      !foreground ||
      !unread_count ||
      document.querySelector('dialog[open]')
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void mobileApi<{ read: boolean }>(
        `/api/mobile/conversations/${id}/read`,
        {
          method: 'POST',
          body: { unread_count, last_message_at },
          signal: controller.signal,
        }
      )
        .then((result) => {
          if (!controller.signal.aborted && result.read) {
            setError('');
            onRead(conversation);
          }
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          if (e instanceof MobileApiError && e.status === 409) {
            onConflict();
            return;
          }
          setError('Read status wasn’t saved.');
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Snapshot identity, rather than incoming object identity, controls retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread_count, last_message_at, enabled, foreground, attempt]);
  return error && unread_count ? (
    <p className="read-status" role="status">
      {error}{' '}
      <button
        className="text"
        onClick={() => {
          setError('');
          setAttempt((n) => n + 1);
        }}
      >
        Retry
      </button>
    </p>
  ) : null;
}
