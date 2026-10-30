'use client';

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Columns3,
  List,
  Tags,
  Search,
  SlidersHorizontal,
  Download,
  Link2,
  Bookmark,
  X,
  FileText,
  Pencil,
  RefreshCw,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Deal, PipelineStage } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PipelinePeopleProvider,
  DealAssignment,
  type DealOwner,
} from './deal-assignment';
import { DealAiSummary } from './deal-card';
import { PipelineTagView } from './pipeline-tag-view';
import { CustomerTagPicker } from './customer-tag-picker';
import { PipelineBoard } from './pipeline-board';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { usePipelineList } from '@/hooks/use-pipeline-list';
import { readPipelineExport } from '@/lib/pipelines/page';
import {
  DEFAULT_DEAL_FILTERS,
  UNASSIGNED,
  dealsCsv,
  isOverdue,
  readDealView,
  writeDealView,
  type DealFilters,
  type DealView,
} from '@/lib/pipelines/deal-views';

function readVisibleDealView(params: URLSearchParams) {
  const state = readDealView(params);
  return {
    ...state,
    filters: {
      ...state.filters,
      currency: '',
      sort:
        state.filters.sort === 'value'
          ? ('newest' as const)
          : state.filters.sort,
    },
  };
}
type SavedView = { id: string; name: string; query: string };
interface Props {
  pipelineId: string;
  stages: PipelineStage[];
  deals: Deal[];
  revision: number;
  onDealsLoaded: (rows: Deal[]) => void;
  onRefresh: () => Promise<void>;
  onDealAssigned: (id: string, owner: DealOwner | null) => void;
  onDealMoved: (dealId: string, stageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
}
function subscribeViews(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('pipeline-views-changed', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('pipeline-views-changed', callback);
  };
}
const VIEWS = [
  { id: 'board', icon: Columns3 },
  { id: 'list', icon: List },
  { id: 'tags', icon: Tags },
] as const;

export function PipelineExplorer(props: Props) {
  const { pipelineId, stages, deals } = props;
  const t = useTranslations('Pipelines.explorer');
  const params = useSearchParams();
  const { accountId, defaultCurrency } = useAuth();
  const [filters, setFilters] = useState<DealFilters>(
    () => readVisibleDealView(new URLSearchParams(params.toString())).filters
  );
  const [view, setView] = useState<DealView>(
    () => readVisibleDealView(new URLSearchParams(params.toString())).view
  );
  const remote = usePipelineList(
    pipelineId,
    filters,
    view,
    props.revision,
    props.onDealsLoaded
  );
  const [exporting, setExporting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const storageKey = `wacrm:pipeline-views:${accountId}:${pipelineId}`;
  const savedJSON = useSyncExternalStore(
    subscribeViews,
    () => {
      try {
        return localStorage.getItem(storageKey) || '[]';
      } catch {
        return '[]';
      }
    },
    () => '[]'
  );
  const saved = useMemo<SavedView[]>(() => {
    try {
      const value: unknown = JSON.parse(savedJSON);
      return Array.isArray(value)
        ? value
            .filter(
              (item): item is SavedView =>
                typeof item?.id === 'string' &&
                typeof item?.name === 'string' &&
                typeof item?.query === 'string'
            )
            .slice(0, 10)
        : [];
    } catch {
      return [];
    }
  }, [savedJSON]);
  const tags = remote.data?.tags ?? [];
  const owners = (remote.data?.owners ?? []).map(([id, name]) => [
    id,
    name || t('unknownOwner'),
  ]);
  const visible = deals;
  const summary = remote.data?.summary;
  const filterCount = (
    Object.keys(DEFAULT_DEAL_FILTERS) as (keyof DealFilters)[]
  ).filter(
    (key) => key !== 'sort' && filters[key] !== DEFAULT_DEAL_FILTERS[key]
  ).length;
  const change = <K extends keyof DealFilters>(key: K, value: DealFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const reset = () => setFilters({ ...DEFAULT_DEAL_FILTERS });
  function persist(next: SavedView[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event('pipeline-views-changed'));
      return true;
    } catch {
      toast.error(t('storageError'));
      return false;
    }
  }
  function saveView(event: React.FormEvent) {
    event.preventDefault();
    if (!viewName.trim()) return;
    const next = [
      {
        id: crypto.randomUUID(),
        name: viewName.trim(),
        query: writeDealView(new URLSearchParams(), view, filters).toString(),
      },
      ...saved,
    ].slice(0, 10);
    if (persist(next)) {
      setViewName('');
      setSaveOpen(false);
      toast.success(t('viewSaved'));
    }
  }
  async function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('pipeline', pipelineId);
    writeDealView(url.searchParams, view, filters);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }
  async function exportCsv() {
    setExporting(true);
    try {
      const exported = await readPipelineExport(createClient(), {
        pipelineId,
        filters,
        view: 'export',
        page: 0,
        stagePages: {},
        fallbackCurrency: defaultCurrency,
      });
      const headers = [
        'deal',
        'customer',
        'phone',
        'stage',
        'status',
        'owner',
        'aiSummary',
        'closeDate',
        'tags',
      ].map((key) => t(key));
      const url = URL.createObjectURL(
        new Blob(
          [
            dealsCsv(
              exported,
              new Map(stages.map((stage) => [stage.id, stage.name])),
              headers
            ),
          ],
          { type: 'text/csv;charset=utf-8;' }
        )
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t('exportError'));
    } finally {
      setExporting(false);
    }
  }
  return (
    <PipelinePeopleProvider
      pipelineId={pipelineId}
      onAssigned={(id, owner) => {
        props.onDealAssigned(id, owner);
        remote.refresh();
      }}
    >
      <section className="space-y-6" aria-label={t('workspace')}>
        <div className="crm-pipeline-summary">
          <div>
            <span>{t('openDeals')}</span>
            <strong>{summary?.open ?? 0}</strong>
          </div>
          <div>
            <span>{t('won')}</span>
            <strong>{summary?.won ?? 0}</strong>
          </div>
          <div>
            <span>{t('overdue')}</span>
            <strong>{summary?.overdue ?? 0}</strong>
          </div>
          <div>
            <span>{t('unassigned')}</span>
            <strong>{summary?.unassigned ?? 0}</strong>
          </div>
        </div>
        <div className="crm-pipeline-tools space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div
              role="group"
              aria-label={t('view')}
              className="bg-muted flex flex-wrap gap-1 rounded-lg p-1"
            >
              {VIEWS.map(({ id, icon: Icon }) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    view === id && 'bg-card text-foreground shadow-sm'
                  )}
                >
                  <Icon className="size-4" />
                  {t(id)}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label={t('viewActions')}
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <MoreHorizontal className="size-5" />
            </Button>
            <div
              className={cn(
                'flex flex-wrap items-center gap-2',
                !toolsOpen && 'hidden md:flex'
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await props.onRefresh();
                  } catch {
                    toast.error(t('loadError'));
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                <RefreshCw
                  className={cn('size-4', refreshing && 'animate-spin')}
                />
                {t('refresh')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSaveOpen(!saveOpen)}
                aria-expanded={saveOpen}
              >
                <Bookmark className="size-4" />
                {t('saveView')}
              </Button>
              <Button variant="ghost" size="sm" onClick={copyLink}>
                <Link2 className="size-4" />
                {t('copyLink')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!remote.data?.total || remote.loading || exporting}
                onClick={exportCsv}
              >
                <Download className="size-4" />
                {t('export')}
              </Button>
            </div>
          </div>
          {saveOpen && (
            <form
              onSubmit={saveView}
              className="bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg p-4"
            >
              <Input
                autoFocus
                aria-label={t('viewName')}
                placeholder={t('viewName')}
                value={viewName}
                maxLength={60}
                onChange={(event) => setViewName(event.target.value)}
                className="min-w-0 flex-1"
              />
              <Button type="submit" size="sm" disabled={!viewName.trim()}>
                {t('save')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSaveOpen(false)}
              >
                {t('cancel')}
              </Button>
              <p className="text-muted-foreground w-full text-xs">
                {t('savedHint')}
              </p>
            </form>
          )}
          {saved.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {t('savedViews')}
              </span>
              {saved.map((item) => (
                <span
                  key={item.id}
                  className="border-border inline-flex max-w-full items-center rounded-lg border"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const next = readVisibleDealView(
                        new URLSearchParams(item.query)
                      );
                      setFilters(next.filters);
                      setView(next.view);
                    }}
                    className="hover:bg-muted focus-visible:outline-ring truncate rounded-s-lg px-3 py-2 text-xs focus-visible:outline-2"
                  >
                    {item.name}
                  </button>
                  <button
                    type="button"
                    aria-label={t('removeView', { name: item.name })}
                    onClick={() =>
                      persist(saved.filter((entry) => entry.id !== item.id))
                    }
                    className="text-muted-foreground hover:text-foreground focus-visible:outline-ring rounded-e-lg p-2 focus-visible:outline-2"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="crm-pipeline-filter-row">
            <div className="relative min-w-0">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4" />
              <Input
                aria-label={t('search')}
                placeholder={t('search')}
                value={filters.query}
                onChange={(event) => change('query', event.target.value)}
                className="h-10 ps-9"
              />
            </div>
            <CustomerTagPicker
              tags={tags}
              value={filters.tag}
              onChange={(value) => change('tag', value)}
            />
            <FilterSelect
              label={t('status')}
              value={filters.status}
              onChange={(value) =>
                change('status', value as DealFilters['status'])
              }
            >
              {['all', 'open', 'won', 'lost'].map((status) => (
                <option key={status} value={status}>
                  {t(status === 'all' ? 'allStatuses' : status)}
                </option>
              ))}
            </FilterSelect>
            <Button
              variant="outline"
              aria-expanded={expanded}
              aria-controls="pipeline-extra-filters"
              onClick={() => setExpanded(!expanded)}
            >
              <SlidersHorizontal className="size-4" />
              {t('filters')}
              {filterCount > 0 && (
                <span className="bg-muted rounded px-1.5 text-xs">
                  {filterCount}
                </span>
              )}
            </Button>
          </div>
          {expanded && (
            <div
              id="pipeline-extra-filters"
              className="border-border grid gap-4 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4"
            >
              <FilterSelect
                label={t('owner')}
                showLabel
                value={filters.owner}
                onChange={(value) => change('owner', value)}
              >
                <option value="">{t('allOwners')}</option>
                <option value={UNASSIGNED}>{t('unassigned')}</option>
                {owners.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label={t('stage')}
                showLabel
                value={filters.stage}
                onChange={(value) => change('stage', value)}
              >
                <option value="">{t('allStages')}</option>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label={t('closeDate')}
                showLabel
                value={filters.due}
                onChange={(value) => change('due', value as DealFilters['due'])}
              >
                {['all', 'overdue', 'today', 'week', 'undated'].map((due) => (
                  <option key={due} value={due}>
                    {t(`due_${due}`)}
                  </option>
                ))}
              </FilterSelect>
            </div>
          )}
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-muted-foreground text-sm">
                {t('showing', {
                  shown: remote.data?.total ?? 0,
                  total: remote.data?.pipelineTotal ?? 0,
                })}
              </p>
              {filterCount > 0 && (
                <Button variant="link" size="sm" onClick={reset}>
                  {t('clearFilters')}
                </Button>
              )}
            </div>
            <FilterSelect
              label={t('sort')}
              value={filters.sort}
              onChange={(value) => change('sort', value as DealFilters['sort'])}
            >
              {['newest', 'oldest', 'updated', 'closing', 'title'].map(
                (sort) => (
                  <option key={sort} value={sort}>
                    {t(`sort_${sort}`)}
                  </option>
                )
              )}
            </FilterSelect>
          </div>
        </div>
        {remote.loading ? (
          <div
            role="status"
            className="text-muted-foreground py-12 text-center"
          >
            {t('loading')}
          </div>
        ) : remote.error ? (
          <div role="alert" className="crm-pipeline-empty">
            <p>{t('loadError')}</p>
            <Button variant="outline" onClick={remote.refresh}>
              {t('retry')}
            </Button>
          </div>
        ) : view === 'tags' ? (
          <PipelineTagView
            candidates={visible}
            summaries={remote.data?.tagGroups}
            allSummary={remote.data?.tagSummary}
            paging={{
              total: remote.data?.total ?? 0,
              page: remote.data?.page ?? 0,
              onChange: remote.setPage,
            }}
            deals={visible}
            stages={stages}
            selectedTag={filters.tag}
            onSelectTag={(value) => change('tag', value)}
            onEditDeal={props.onEditDeal}
            onOpenQuotations={props.onOpenQuotations}
            onDealMoved={props.onDealMoved}
          />
        ) : !visible.length ? (
          <div className="crm-pipeline-empty">
            <Search className="text-muted-foreground size-8" />
            <h3 className="text-lg font-semibold">
              {t(deals.length ? 'noMatches' : 'noDeals')}
            </h3>
            <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
              {t(deals.length ? 'noMatchesHint' : 'noDealsHint')}
            </p>
            {filterCount > 0 && (
              <Button variant="outline" onClick={reset}>
                {t('clearFilters')}
              </Button>
            )}
          </div>
        ) : view === 'board' ? (
          <>
            <p className="text-muted-foreground text-xs">{t('boardHint')}</p>
            <PipelineBoard
              {...props}
              deals={visible}
              paging={{
                counts: remote.data?.stageCounts ?? {},
                pages: remote.data?.stagePages ?? {},
                onChange: remote.setStagePage,
              }}
            />
          </>
        ) : (
          <DealList
            {...props}
            deals={visible}
            paging={{
              total: remote.data?.total ?? 0,
              page: remote.data?.page ?? 0,
              onChange: remote.setPage,
            }}
          />
        )}
      </section>
    </PipelinePeopleProvider>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
  showLabel = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  showLabel?: boolean;
}) {
  return (
    <label className="text-muted-foreground grid min-w-0 gap-2 text-xs font-medium">
      <span className={showLabel ? '' : 'sr-only'}>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-border bg-card text-foreground focus-visible:outline-ring h-10 w-full min-w-0 rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {children}
      </select>
    </label>
  );
}
function DealList({
  paging,
  deals,
  stages,
  onDealMoved,
  onEditDeal,
  onOpenQuotations,
}: Props & {
  paging?: { total: number; page: number; onChange: (page: number) => void };
}) {
  const t = useTranslations('Pipelines.explorer');
  const c = useTranslations('Pipelines.smartCard');
  const [localPage, setLocalPage] = useState(0);
  const total = paging?.total ?? deals.length;
  const page = paging?.page ?? localPage;
  const setPage = paging?.onChange ?? setLocalPage;
  const pages = Math.max(1, Math.ceil(total / 25));
  const current = Math.min(page, pages - 1);
  const shown = paging ? deals : deals.slice(current * 25, (current + 1) * 25);
  const locale = useLocale();
  const { profile, accountRole } = useAuth();
  const canWrite = useCan('send-messages');
  const canMove = (deal: Deal) =>
    canWrite &&
    (accountRole === 'owner' ||
      accountRole === 'admin' ||
      (!!profile?.id && deal.assigned_to === profile.id));
  return (
    <div
      className="crm-pipeline-list border-border overflow-x-auto rounded-xl border"
      role="region"
      aria-label={t('list')}
      tabIndex={0}
    >
      <table className="w-full min-w-[860px] table-fixed text-start text-sm">
        <colgroup>
          <col className="w-[25%]" />
          <col className="w-[18%]" />
          <col className="w-[27%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <tr className="border-border bg-muted/40 text-muted-foreground border-b text-xs">
            {[
              'deal',
              'stage',
              'aiSummary',
              'owner',
              'closeDate',
              'actions',
            ].map((label) => (
              <th key={label} className="px-5 py-4 text-start font-medium">
                {t(label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {shown.map((deal) => (
            <tr key={deal.id} className="hover:bg-muted/30">
              <td className="max-w-[300px] px-5 py-5">
                <button
                  type="button"
                  onClick={() => onEditDeal(deal)}
                  className="hover:text-primary focus-visible:outline-ring block max-w-full truncate text-start font-medium focus-visible:outline-2"
                >
                  {deal.title}
                </button>
                <p className="text-muted-foreground mt-1 text-xs">
                  {deal.contact?.name || deal.contact?.phone || t('noContact')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(deal.contact?.tags ?? []).map((tag) => (
                    <span
                      key={tag.id}
                      className="crm-colored-tag rounded border px-1.5 py-0.5 text-[11px]"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${tag.color} 12%, var(--card))`,
                        borderColor: `color-mix(in srgb, ${tag.color} 30%, var(--border))`,
                      }}
                    >
                      <i style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-5 py-5">
                <select
                  aria-label={t('moveDeal', { title: deal.title })}
                  value={deal.stage_id}
                  disabled={!canMove(deal)}
                  onChange={(event) => onDealMoved(deal.id, event.target.value)}
                  className="border-border bg-card focus-visible:outline-ring h-9 max-w-48 rounded-lg border px-2 text-xs focus-visible:outline-2 disabled:opacity-70"
                >
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground mt-2 text-xs">
                  {t(deal.status || 'open')}
                </p>
              </td>
              <td className="px-5 py-5">
                <DealAiSummary deal={deal} compact />
              </td>
              <td
                data-label={t('owner')}
                className="text-muted-foreground max-w-40 px-5 py-5"
              >
                <DealAssignment deal={deal} />
              </td>
              <td
                data-label={t('closeDate')}
                className={cn(
                  'px-5 py-5 text-xs whitespace-nowrap',
                  isOverdue(deal) ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {deal.expected_close_date
                  ? new Date(
                      `${deal.expected_close_date}T12:00:00`
                    ).toLocaleDateString(locale, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—'}
                {isOverdue(deal) && (
                  <span className="mt-1 block">{t('overdue')}</span>
                )}
              </td>
              <td className="px-5 py-5">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('openDeal', { title: deal.title })}
                    onClick={() => onEditDeal(deal)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('quotationsFor', { title: deal.title })}
                    onClick={() => onOpenQuotations(deal)}
                  >
                    <FileText className="size-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-4">
          <p role="status" className="text-muted-foreground text-xs">
            {c('dealPage', { page: current + 1, pages, total })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              {c('previousDeals')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              {c('nextDeals')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
