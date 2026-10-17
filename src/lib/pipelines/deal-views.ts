import { getPipelineOwner } from './deal-owner';
import type { Deal, Tag } from '@/types';

export const NO_TAG = '__untagged__';
export const UNASSIGNED = '__unassigned__';
export type DealView = 'board' | 'list' | 'tags';
export interface DealFilters {
  query: string;
  tag: string;
  status: 'all' | 'open' | 'won' | 'lost';
  owner: string;
  stage: string;
  due: 'all' | 'overdue' | 'today' | 'week' | 'undated';
  currency: string;
  sort: 'newest' | 'oldest' | 'updated' | 'closing' | 'value' | 'title';
}
export const DEFAULT_DEAL_FILTERS: DealFilters = {
  query: '',
  tag: '',
  status: 'all',
  owner: '',
  stage: '',
  due: 'all',
  currency: '',
  sort: 'newest',
};
export function readDealView(params: URLSearchParams): {
  view: DealView;
  filters: DealFilters;
} {
  const view = params.get('view');
  const status = params.get('status');
  const due = params.get('due');
  const sort = params.get('sort');
  return {
    view: view === 'list' || view === 'tags' ? view : 'board',
    filters: {
      query: params.get('q') ?? '',
      tag: params.get('tag') ?? '',
      status:
        status === 'open' || status === 'won' || status === 'lost'
          ? status
          : 'all',
      owner: params.get('owner') ?? '',
      stage: params.get('stage') ?? '',
      due:
        due === 'overdue' ||
        due === 'today' ||
        due === 'week' ||
        due === 'undated'
          ? due
          : 'all',
      currency: params.get('currency') ?? '',
      sort:
        sort === 'oldest' ||
        sort === 'updated' ||
        sort === 'closing' ||
        sort === 'value' ||
        sort === 'title'
          ? sort
          : 'newest',
    },
  };
}
export function writeDealView(
  params: URLSearchParams,
  view: DealView,
  filters: DealFilters
) {
  params.set('view', view);
  for (const key of Object.keys(
    DEFAULT_DEAL_FILTERS
  ) as (keyof DealFilters)[]) {
    const param = key === 'query' ? 'q' : key;
    if (filters[key] === DEFAULT_DEAL_FILTERS[key]) params.delete(param);
    else params.set(param, filters[key]);
  }
  return params;
}
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function isOverdue(deal: Deal, today = dateKey(new Date())) {
  return (
    (deal.status ?? 'open') === 'open' &&
    !!deal.expected_close_date &&
    deal.expected_close_date < today
  );
}
export function filterDeals(
  deals: Deal[],
  filters: DealFilters,
  now = new Date(),
  fallbackCurrency = 'USD'
): Deal[] {
  const today = dateKey(now);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const weekEnd = dateKey(nextWeek);
  const query = filters.query.trim().toLocaleLowerCase();
  const result = deals.filter((deal) => {
    const tags = deal.contact?.tags ?? [];
    if (
      filters.tag === NO_TAG
        ? tags.length > 0
        : filters.tag && !tags.some((tag) => tag.id === filters.tag)
    )
      return false;
    if (filters.status !== 'all' && (deal.status ?? 'open') !== filters.status)
      return false;
    if (filters.owner && getPipelineOwner(deal).unavailable) return false;
    if (
      filters.owner === UNASSIGNED
        ? !!getPipelineOwner(deal).id
        : filters.owner && getPipelineOwner(deal).id !== filters.owner
    )
      return false;
    if (filters.stage && deal.stage_id !== filters.stage) return false;
    if (
      filters.currency &&
      (deal.currency || fallbackCurrency) !== filters.currency
    )
      return false;
    if (
      query &&
      ![
        deal.title,
        deal.contact?.name,
        deal.contact?.phone,
        getPipelineOwner(deal).name,
        deal.notes,
        ...tags.map((tag) => tag.name),
      ].some((value) => value?.toLocaleLowerCase().includes(query))
    )
      return false;
    if (filters.due === 'undated') return !deal.expected_close_date;
    if (filters.due !== 'all') {
      if ((deal.status ?? 'open') !== 'open' || !deal.expected_close_date)
        return false;
      if (filters.due === 'overdue') return isOverdue(deal, today);
      if (filters.due === 'today') return deal.expected_close_date === today;
      return (
        deal.expected_close_date >= today && deal.expected_close_date <= weekEnd
      );
    }
    return true;
  });
  return result.sort((a, b) => {
    switch (filters.sort) {
      case 'oldest':
        return a.created_at.localeCompare(b.created_at);
      case 'updated':
        return (b.updated_at || b.created_at).localeCompare(
          a.updated_at || a.created_at
        );
      case 'closing':
        return (a.expected_close_date || '9999').localeCompare(
          b.expected_close_date || '9999'
        );
      case 'value':
        return (
          (a.currency || fallbackCurrency).localeCompare(
            b.currency || fallbackCurrency
          ) || Number(b.value || 0) - Number(a.value || 0)
        );
      case 'title':
        return a.title.localeCompare(b.title);
      default:
        return b.created_at.localeCompare(a.created_at);
    }
  });
}
export function dealTags(deals: Deal[]): Tag[] {
  return Array.from(
    new Map(
      deals
        .flatMap((deal) => deal.contact?.tags ?? [])
        .map((tag) => [tag.id, tag])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));
}
export function groupDealsByTag(deals: Deal[]) {
  const groups: { id: string; tag: Tag | null; deals: Deal[] }[] = dealTags(
    deals
  ).map((tag) => ({
    id: tag.id,
    tag,
    deals: deals.filter((deal) =>
      deal.contact?.tags?.some((item) => item.id === tag.id)
    ),
  }));
  const untagged = deals.filter((deal) => !deal.contact?.tags?.length);
  if (untagged.length) groups.push({ id: NO_TAG, tag: null, deals: untagged });
  return groups;
}
export function totalsByCurrency(deals: Deal[], fallbackCurrency: string) {
  const totals = new Map<string, number>();
  for (const deal of deals) {
    const code = deal.currency || fallbackCurrency;
    totals.set(code, (totals.get(code) ?? 0) + Number(deal.value || 0));
  }
  return Array.from(totals, ([currency, value]) => ({ currency, value })).sort(
    (a, b) => a.currency.localeCompare(b.currency)
  );
}
/** Quote every cell; neutralize spreadsheet formulas, including leading whitespace. */
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function dealsCsv(
  deals: Deal[],
  stageNames: Map<string, string>,
  headers: string[]
) {
  return (
    '\uFEFF' +
    [
      headers,
      ...deals.map((deal) => [
        deal.title,
        deal.contact?.name,
        deal.contact?.phone,
        stageNames.get(deal.stage_id),
        deal.status || 'open',
        getPipelineOwner(deal).name,
        deal.aiSummary?.text,
        deal.expected_close_date,
        (deal.contact?.tags ?? []).map((tag) => tag.name).join('; '),
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
