'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { SalesContext } from '@/lib/inbox/sales-context';

type Snapshot = {
  scope: string;
  versions: Map<string, string>;
  data: Record<string, SalesContext>;
};
const EMPTY: Record<string, SalesContext> = {};

// Message timestamps identify which conversations need fresh read receipts.
// Retain the remaining context instead of reloading the entire inbox per message.
export function useSalesContext(signature: string) {
  const canRead = useCan('send-messages');
  const { accountId, user } = useAuth();
  const scope = `${accountId}:${user?.id}`;
  const cache = useRef<Snapshot>({ scope: '', versions: new Map(), data: {} });
  const [state, setState] = useState({ scope: '', data: EMPTY, error: false });
  useEffect(() => {
    if (!canRead || !accountId || !user?.id) return;
    const versions = new Map(
      signature
        .split(',')
        .filter(Boolean)
        .map((entry) => {
          const [id, ...timestamp] = entry.split('|');
          return [id, timestamp.join('|')];
        })
    );
    let disposed = false;
    let controller: AbortController | undefined;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let refreshAll = false;
    async function load(all: boolean) {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const previous =
        cache.current.scope === scope
          ? cache.current
          : { scope, versions: new Map<string, string>(), data: EMPTY };
      const ids = [...versions.keys()].filter(
        (id) => all || previous.versions.get(id) !== versions.get(id)
      );
      try {
        const result: SalesContext[] = [];
        // Bound concurrency so a large inbox cannot start a burst of RPCs.
        for (let offset = 0; offset < ids.length; offset += 500) {
          const response = await fetch('/api/inbox/sales-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids.slice(offset, offset + 500) }),
            signal: request.signal,
          });
          if (!response.ok) throw new Error('load');
          result.push(...((await response.json()) as SalesContext[]));
        }
        if (disposed || request.signal.aborted) return;
        const data = Object.fromEntries(
          Object.entries(previous.data).filter(([id]) => versions.has(id))
        );
        for (const id of ids) delete data[id];
        for (const row of result)
          if (versions.has(row.conversation_id))
            data[row.conversation_id] = row;
        cache.current = { scope, versions, data };
        setState({ scope, data, error: false });
      } catch {
        if (!disposed && !request.signal.aborted)
          setState((previousState) => ({
            scope,
            data: previousState.scope === scope ? previousState.data : EMPTY,
            error: true,
          }));
      }
    }
    const schedule = (all: boolean) => {
      refreshAll ||= all;
      if (scheduled) clearTimeout(scheduled);
      scheduled = setTimeout(() => {
        scheduled = undefined;
        const full = refreshAll;
        refreshAll = false;
        void load(full);
      }, 250);
    };
    const refresh = () => schedule(true);
    const resume = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    schedule(false);
    const timer = setInterval(refresh, 30000);
    window.addEventListener('group-work-updated', refresh);
    window.addEventListener('sales-followups-updated', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(scheduled);
      clearInterval(timer);
      window.removeEventListener('group-work-updated', refresh);
      window.removeEventListener('sales-followups-updated', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [signature, canRead, scope, accountId, user?.id]);
  return {
    data: canRead && state.scope === scope ? state.data : EMPTY,
    error: canRead && state.scope === scope && state.error,
    loading: canRead && state.scope !== scope,
    available: canRead,
  };
}
