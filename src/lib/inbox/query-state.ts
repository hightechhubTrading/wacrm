import { SALES_VIEWS } from './sales-context';

export const INBOX_VIEWS = [
  'all',
  'unread',
  'mine',
  'priority',
  'unassigned',
  'open',
  'pending',
  'closed',
  ...SALES_VIEWS,
] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export type InboxSort = 'priority' | 'newest' | 'oldest';
export interface InboxQuery {
  search: string;
  view: InboxView;
  sort: InboxSort;
  tags: string[];
  company: string | null;
  agent: string | null;
}
export const DEFAULT_INBOX_QUERY: InboxQuery = {
  search: '',
  view: 'all',
  sort: 'priority',
  tags: [],
  company: null,
  agent: null,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeInboxQuery(
  value: Partial<InboxQuery>,
  canReadSales = true
): InboxQuery {
  const view = INBOX_VIEWS.includes(value.view as InboxView)
    ? value.view!
    : 'all';
  return {
    search: typeof value.search === 'string' ? value.search.slice(0, 200) : '',
    view:
      !canReadSales &&
      SALES_VIEWS.includes(view as (typeof SALES_VIEWS)[number])
        ? 'all'
        : view,
    sort: ['priority', 'newest', 'oldest'].includes(value.sort ?? '')
      ? value.sort!
      : 'priority',
    tags: Array.isArray(value.tags)
      ? [
          ...new Set(
            value.tags.filter((id) => typeof id === 'string' && uuid.test(id))
          ),
        ]
          .sort()
          .slice(0, 30)
      : [],
    company:
      typeof value.company === 'string' && value.company
        ? value.company.slice(0, 200)
        : null,
    agent:
      typeof value.agent === 'string' &&
      (value.agent === '__unassigned__' || uuid.test(value.agent))
        ? value.agent
        : null,
  };
}
export function parseInboxQuery(search: string, canReadSales = true) {
  const params = new URLSearchParams(search);
  return normalizeInboxQuery(
    {
      search: params.get('q') ?? '',
      view: params.get('view') as InboxView,
      sort: params.get('sort') as InboxSort,
      tags: params.getAll('tag'),
      company: params.get('company'),
      agent: params.get('agent'),
    },
    canReadSales
  );
}
export function writeInboxQuery(url: URL, query: InboxQuery) {
  const result = new URL(url);
  for (const key of ['q', 'view', 'sort', 'tag', 'company', 'agent'])
    result.searchParams.delete(key);
  if (query.search) result.searchParams.set('q', query.search);
  if (query.view !== 'all') result.searchParams.set('view', query.view);
  if (query.sort !== 'priority') result.searchParams.set('sort', query.sort);
  for (const tag of query.tags) result.searchParams.append('tag', tag);
  if (query.company) result.searchParams.set('company', query.company);
  if (query.agent) result.searchParams.set('agent', query.agent);
  return result;
}
export interface SavedInboxView {
  id: string;
  name: string;
  query: InboxQuery;
}
export function parseSavedInboxViews(
  raw: string,
  canReadSales = true
): SavedInboxView[] {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (v) =>
          v &&
          typeof v.id === 'string' &&
          uuid.test(v.id) &&
          typeof v.name === 'string' &&
          v.name.trim() &&
          v.query &&
          typeof v.query === 'object'
      )
      .slice(0, 20)
      .map((v) => ({
        id: v.id,
        name: v.name.slice(0, 64),
        query: normalizeInboxQuery(v.query, canReadSales),
      }));
  } catch {
    return [];
  }
}
