'use client';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  normalizeInboxQuery,
  parseInboxQuery,
  writeInboxQuery,
  type InboxQuery,
} from '@/lib/inbox/query-state';
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener('crm-inbox-query', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('crm-inbox-query', listener);
  };
}
export function useInboxQuery(canReadSales: boolean) {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => ''
  );
  const query = useMemo(
    () => parseInboxQuery(search, canReadSales),
    [search, canReadSales]
  );
  const update = useCallback(
    (
      change: Partial<InboxQuery> | ((previous: InboxQuery) => InboxQuery),
      mode: 'push' | 'replace' = 'push'
    ) => {
      const previous = parseInboxQuery(window.location.search, canReadSales);
      const next = normalizeInboxQuery(
        typeof change === 'function'
          ? change(previous)
          : { ...previous, ...change },
        canReadSales
      );
      const url = writeInboxQuery(new URL(window.location.href), next);
      if (url.href !== window.location.href) {
        window.history[mode === 'push' ? 'pushState' : 'replaceState'](
          window.history.state,
          '',
          url.pathname + url.search + url.hash
        );
        window.dispatchEvent(new Event('crm-inbox-query'));
      }
    },
    [canReadSales]
  );
  return { query, update };
}
