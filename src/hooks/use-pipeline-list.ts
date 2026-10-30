'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { readPipelinePage, type PipelinePage } from '@/lib/pipelines/page';
import type { DealFilters, DealView } from '@/lib/pipelines/deal-views';
import type { Deal } from '@/types';

export function usePipelineList(
  pipelineId: string,
  filters: DealFilters,
  view: DealView,
  revision: number,
  onLoaded: (rows: Deal[]) => void
) {
  const { accountId, user, accountRole, defaultCurrency } = useAuth();
  const key = JSON.stringify([
    accountId,
    user?.id,
    accountRole,
    pipelineId,
    filters,
    view,
    defaultCurrency,
  ]);
  const callback = useRef(onLoaded);
  useEffect(() => {
    callback.current = onLoaded;
  });
  const [position, setPosition] = useState({
    key,
    page: 0,
    stages: {} as Record<string, number>,
  });
  if (position.key !== key) setPosition({ key, page: 0, stages: {} });
  const page = position.key === key ? position.page : 0;
  const stagePages = position.key === key ? position.stages : {};
  const pageKey = JSON.stringify([page, stagePages]);
  const [refresh, setRefresh] = useState(0);
  const lastRequest = useRef({ key: '', revision: -1, refresh: -1 });
  const [state, setState] = useState({
    key: '',
    pageKey: '',
    busy: false,
    error: false,
    data: null as PipelinePage | null,
  });
  useEffect(() => {
    if (!accountId || !user?.id || !pipelineId) return;
    const controller = new AbortController();
    const previous = lastRequest.current;
    const searchChanged =
      previous.key &&
      JSON.parse(previous.key)[4].query !== JSON.parse(key)[4].query;
    const refreshed =
      previous.key === key &&
      (previous.revision !== revision || previous.refresh !== refresh);
    const delay = searchChanged || refreshed ? 250 : 0;
    lastRequest.current = { key, revision, refresh };

    const timer = setTimeout(() => {
      setState((previous) => ({ ...previous, busy: true, error: false }));
      const [, , , id, currentFilters, currentView, currency] = JSON.parse(key);
      const [currentPage, currentStages] = JSON.parse(pageKey);
      void readPipelinePage(
        createClient(),
        {
          pipelineId: id,
          filters: currentFilters,
          view: currentView,
          page: currentPage,
          stagePages: currentStages,
          fallbackCurrency: currency,
        },
        controller.signal
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          callback.current(data.items);
          setState({ key, pageKey, busy: false, error: false, data });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState((previous) => ({
              ...previous,
              key,
              pageKey,
              busy: false,
              error: true,
            }));
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, pageKey, revision, refresh, accountId, user?.id, pipelineId]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible')
        setRefresh((value) => value + 1);
    };
    const timer = setInterval(resume, 60_000);
    window.addEventListener('focus', resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', resume);
    };
  }, []);
  const data = state.key === key ? state.data : null;
  return {
    data,
    loading: (state.key !== key || state.pageKey !== pageKey) && !state.error,
    busy: state.busy,
    error: state.error,
    setPage: (next: number) =>
      setPosition({ key, page: next, stages: stagePages }),
    setStagePage: (id: string, next: number) =>
      setPosition({
        key,
        page,
        stages: { ...(data?.stagePages ?? stagePages), [id]: next },
      }),
    refresh: () => setRefresh((value) => value + 1),
  };
}
