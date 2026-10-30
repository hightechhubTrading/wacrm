import type { SupabaseClient } from '@supabase/supabase-js';
import type { Deal, Tag } from '@/types';
import { dateKey, type DealFilters, type DealView } from './deal-views';

export interface TagGroupSummary {
  id: string;
  tag: Tag | null;
  total: number;
  open: number;
  overdue: number;
}
export interface PipelinePage {
  items: Deal[];
  total: number;
  pipelineTotal: number;
  page: number;
  stageCounts: Record<string, number>;
  stagePages: Record<string, number>;
  summary: { open: number; won: number; overdue: number; unassigned: number };
  tagSummary: { total: number; open: number; overdue: number };
  tags: Tag[];
  owners: [string, string | null][];
  tagGroups: TagGroupSummary[];
}
export interface PipelineQuery {
  pipelineId: string;
  filters: DealFilters;
  view: DealView | 'export';
  page: number;
  stagePages: Record<string, number>;
  fallbackCurrency: string;
}
export async function readPipelinePage(
  db: SupabaseClient,
  query: PipelineQuery,
  signal?: AbortSignal
): Promise<PipelinePage> {
  const today = new Date(),
    weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  let request = db.rpc('pipeline_list', {
    p_pipeline: query.pipelineId,
    p_filters: query.filters,
    p_view: query.view,
    p_page: query.page,
    p_stage_pages: query.stagePages,
    p_today: dateKey(today),
    p_week_end: dateKey(weekEnd),
    p_fallback_currency: query.fallbackCurrency,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data as PipelinePage;
}

/** Explicit export action reads all matching pages, never just mounted cards. */
export async function readPipelineExport(
  db: SupabaseClient,
  query: PipelineQuery
): Promise<Deal[]> {
  const rows = new Map<string, Deal>();
  let total: number | undefined;
  for (let page = 0; ; page++) {
    const result = await readPipelinePage(db, {
      ...query,
      view: 'export',
      page,
      stagePages: {},
    });
    total ??= result.total;
    if (result.total !== total || result.page !== page)
      throw new Error('Pipeline changed during export. Retry the export.');
    for (const row of result.items) rows.set(row.id, row);
    if ((page + 1) * 100 >= total) {
      if (rows.size !== total)
        throw new Error('Pipeline changed during export. Retry the export.');
      return [...rows.values()];
    }
    if (!result.items.length) throw new Error('Incomplete pipeline export');
  }
}
