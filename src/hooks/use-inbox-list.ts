'use client';
import { recordReliability } from '@/lib/inbox/reliability';
import { businessDayEnd } from '@/lib/business-time';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { Conversation } from '@/types';
import { SALES_VIEWS, type SalesView } from '@/lib/inbox/sales-context';

type Cursor = { k1: number; k2: number; kt: number; id: string };
type Page = {
  items: Conversation[];
  counts: Record<string, number>;
  companies: string[];
  total: number;
  nextCursor: Cursor | null;
};
export function useInboxList(
  query: {
    search: string;
    view: string;
    sort: string;
    tags: string[];
    company: string | null;
    agent: string | null;
  },
  reloadToken: number,
  onLoaded: (rows: Conversation[]) => void
) {
  const { accountId, user, accountRole } = useAuth();
  const scope = `${accountId}:${user?.id}:${accountRole}`;
  const key = JSON.stringify([scope, query]);
  const callback = useRef(onLoaded);
  useEffect(() => {
    callback.current = onLoaded;
  });
  const [requested, setRequested] = useState({ key, pages: 1 });
  if (requested.key !== key) setRequested({ key, pages: 1 });
  const pages = requested.key === key ? requested.pages : 1;
  const cache = useRef({
    key: '',
    revision: '',
    pages: [] as Page[],
    sales: null as Record<string, number> | null,
  });
  const [state, setState] = useState({
    key: '',
    busy: false,
    error: false,
    counts: {} as Record<string, number>,
    companies: [] as string[],
    hasMore: false,
    salesLoading: false,
    salesError: false,
  });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!accountId || !user?.id) return;
    const controller = new AbortController();
    const revision = `${reloadToken}:${refresh}`;
    const prior = cache.current;
    const priorQuery = prior.key
      ? (JSON.parse(prior.key)[1] as typeof query)
      : null;
    const delay =
      (priorQuery && priorQuery.search !== JSON.parse(key)[1].search) ||
      (prior.key === key && prior.revision !== revision)
        ? 250
        : 0;

    const current =
      cache.current.key === key && cache.current.revision === revision
        ? cache.current
        : {
            key,
            revision,
            pages: [] as Page[],
            sales: null as Record<string, number> | null,
          };
    cache.current = current;
    const timer = setTimeout(async () => {
      const started = performance.now();
      setState((previous) => ({ ...previous, busy: true, error: false }));
      try {
        const args = JSON.parse(key)[1] as typeof query;
        const dayEnd = businessDayEnd();
        const needsSales = SALES_VIEWS.includes(args.view as SalesView);
        const canSales = ['owner', 'admin', 'agent'].includes(
          accountRole ?? ''
        );
        const parameters = {
          p_account: accountId,
          p_search: args.search,
          p_view: args.view,
          p_sort: args.sort,
          p_tags: args.tags,
          p_company: args.company,
          p_agent: args.agent,
          p_day_end: dayEnd.toISOString(),
        };
        while (current.pages.length < pages) {
          const previous = current.pages.at(-1);
          if (previous && !previous.nextCursor) break;
          const { data, error } = await createClient()
            .rpc('inbox_list', {
              ...parameters,
              p_cursor: previous?.nextCursor ?? null,
              p_limit: 50,
              p_sales: needsSales,
              p_metadata_only: false,
            })
            .abortSignal(controller.signal);
          if (error) throw error;
          if (controller.signal.aborted) return;
          current.pages.push(data as Page);
        }
        if (controller.signal.aborted) return;
        const first = current.pages[0],
          last = current.pages.at(-1);
        const rows = new Map(
          current.pages
            .flatMap((page) => page.items)
            .map((row) => [row.id, row])
        );
        if (needsSales) current.sales = first?.counts ?? {};
        callback.current([...rows.values()]);
        recordReliability('queue.ready', performance.now() - started);
        setState({
          key,
          busy: false,
          error: false,
          counts: { ...(first?.counts ?? {}), ...(current.sales ?? {}) },
          companies: first?.companies ?? [],
          hasMore: !!last?.nextCursor,
          salesLoading: canSales && !current.sales,
          salesError: false,
        });
        if (canSales && !current.sales) {
          // Paint the useful list before the more expensive global queue counts.
          // These facts are cached for this query/revision and never download rows.
          try {
            const { data, error } = await createClient()
              .rpc('inbox_list', {
                ...parameters,
                p_cursor: null,
                p_limit: 50,
                p_sales: true,
                p_metadata_only: true,
              })
              .abortSignal(controller.signal);
            if (error) throw error;
            if (controller.signal.aborted) return;
            current.sales = (data as Page).counts;
            setState((previous) =>
              previous.key === key
                ? {
                    ...previous,
                    counts: { ...previous.counts, ...current.sales },
                    salesLoading: false,
                    salesError: false,
                  }
                : previous
            );
          } catch {
            if (!controller.signal.aborted)
              setState((previous) =>
                previous.key === key
                  ? { ...previous, salesLoading: false, salesError: true }
                  : previous
              );
          }
        }
      } catch {
        if (!controller.signal.aborted)
          recordReliability('queue.failed', performance.now() - started);
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            key,
            busy: false,
            error: true,
          }));
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, pages, reloadToken, refresh, accountId, user?.id, accountRole]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible')
        setRefresh((value) => value + 1);
    };
    const timer = setInterval(update, 60_000);
    window.addEventListener('group-work-updated', update);
    window.addEventListener('sales-followups-updated', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('group-work-updated', update);
      window.removeEventListener('sales-followups-updated', update);
    };
  }, []);
  return {
    loading: state.key !== key && !state.error,
    busy: state.busy,
    error: state.error,
    salesLoading: state.salesLoading,
    salesError: state.salesError,
    counts: state.key === key ? state.counts : {},
    companies: state.key === key ? state.companies : [],
    hasMore: state.key === key && state.hasMore,
    loadMore: () => setRequested({ key, pages: pages + 1 }),
  };
}
