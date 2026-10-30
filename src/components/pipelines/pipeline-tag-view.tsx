'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Deal, PipelineStage } from '@/types';
import { groupDealsByTag, isOverdue } from '@/lib/pipelines/deal-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DealCard } from './deal-card';
import type { TagGroupSummary } from '@/lib/pipelines/page';

interface Props {
  summaries?: TagGroupSummary[];
  allSummary?: { total: number; open: number; overdue: number };
  paging?: { total: number; page: number; onChange: (page: number) => void };
  candidates: Deal[];
  deals: Deal[];
  stages: PipelineStage[];
  selectedTag: string;
  onSelectTag: (id: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
  onDealMoved: (id: string, stageId: string) => void;
}
const PAGE_SIZE = 5;
export function PipelineTagView({
  summaries,
  allSummary,
  paging,
  candidates,
  deals,
  stages,
  selectedTag,
  onSelectTag,
  onEditDeal,
  onOpenQuotations,
  onDealMoved,
}: Props) {
  const t = useTranslations('Pipelines.explorer');
  const c = useTranslations('Pipelines.smartCard');
  const resultsRef = useRef<HTMLElement>(null);
  const previousTag = useRef(selectedTag);
  useEffect(() => {
    if (previousTag.current === selectedTag) return;
    previousTag.current = selectedTag;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    resultsRef.current?.focus({ preventScroll: true });
    resultsRef.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [selectedTag]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const groups = useMemo(
    () =>
      summaries ??
      groupDealsByTag(candidates).map((group) => ({
        id: group.id,
        tag: group.tag,
        total: group.deals.length,
        open: group.deals.filter((deal) => (deal.status || 'open') === 'open')
          .length,
        overdue: group.deals.filter((deal) => isOverdue(deal)).length,
      })),
    [candidates, summaries]
  );
  const matches = groups.filter((group) =>
    (group.tag?.name || t('untagged'))
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const selected = groups.find((group) => group.id === selectedTag);
  return (
    <div className="space-y-8">
      <details
        key={selectedTag}
        open={!selectedTag}
        className="crm-tag-browser"
        aria-label={c('browseTags')}
      >
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
          <span>{selectedTag ? c('changeTag') : c('browseTags')}</span>
          <span className="text-muted-foreground">
            {selectedTag
              ? selected?.tag?.name || t('untagged')
              : c('openBrowser')}
          </span>
        </summary>
        <div className="mt-5 grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{c('browseTags')}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {c('browseHint')}
              </p>
            </div>
            <div className="relative w-full min-w-0 sm:w-64">
              <Search className="text-muted-foreground absolute start-3 top-3 size-4" />
              <Input
                aria-label={c('findTag')}
                placeholder={c('findTag')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="h-10 ps-9"
              />
            </div>
          </div>
          <div className="crm-tag-tiles">
            {[
              {
                id: '',
                tag: null,
                ...(allSummary ?? {
                  total: candidates.length,
                  open: candidates.filter(
                    (deal) => (deal.status || 'open') === 'open'
                  ).length,
                  overdue: candidates.filter((deal) => isOverdue(deal)).length,
                }),
              },
              ...shown,
            ].map((group) => {
              const { open, overdue } = group;
              return (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={selectedTag === group.id}
                  onClick={() => onSelectTag(group.id)}
                  className="crm-tag-tile"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm leading-snug font-semibold">
                      {group.id
                        ? group.tag?.name || t('untagged')
                        : c('allDeals')}
                    </span>
                    <Tags
                      className="text-muted-foreground size-4 shrink-0"
                      style={{ color: group.tag?.color }}
                    />
                  </span>
                  <strong>{group.total}</strong>
                  <span className="text-muted-foreground text-xs">
                    {c('openCount', { count: open })}
                    {overdue > 0 && (
                      <span className="text-destructive ms-2">
                        {c('overdueCount', { count: overdue })}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-muted-foreground text-xs">
              {matches.length
                ? c('tagPage', {
                    page: current + 1,
                    pages,
                    total: matches.length,
                  })
                : c('noTags')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={c('previousTags')}
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <ArrowLeft className="size-4 rtl:rotate-180" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={c('nextTags')}
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </div>
      </details>
      <section
        ref={resultsRef}
        tabIndex={-1}
        aria-label={c('matchingDeals')}
        className="scroll-mt-6 space-y-5 focus:outline-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {selectedTag
                ? selected?.tag?.name || t('untagged')
                : c('allDeals')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('dealCount', { count: paging?.total ?? deals.length })} ·{' '}
              {c('uniqueDeals')}
            </p>
          </div>
          {selectedTag && (
            <Button variant="ghost" size="sm" onClick={() => onSelectTag('')}>
              {c('allDeals')}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          )}
        </div>
        <SmartDealGrid
          key={selectedTag}
          paging={paging}
          deals={deals}
          stages={stages}
          onDealMoved={onDealMoved}
          onEditDeal={onEditDeal}
          onOpenQuotations={onOpenQuotations}
        />
        {!deals.length && (
          <p className="text-muted-foreground py-8 text-sm">
            {t('noMatchesHint')}
          </p>
        )}
      </section>
    </div>
  );
}

function SmartDealGrid({
  paging,
  deals,
  stages,
  onDealMoved,
  onEditDeal,
  onOpenQuotations,
}: Pick<
  Props,
  | 'paging'
  | 'deals'
  | 'stages'
  | 'onDealMoved'
  | 'onEditDeal'
  | 'onOpenQuotations'
>) {
  const c = useTranslations('Pipelines.smartCard');
  const [localPage, setLocalPage] = useState(0);
  const total = paging?.total ?? deals.length;
  const page = paging?.page ?? localPage;
  const setPage = paging?.onChange ?? setLocalPage;
  const pages = Math.max(1, Math.ceil(total / 6));
  const current = Math.min(page, pages - 1);
  const shown = paging ? deals : deals.slice(current * 6, (current + 1) * 6);
  return (
    <>
      <div className="crm-smart-deal-grid">
        {' '}
        {shown.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            stage={stages.find((stage) => stage.id === deal.stage_id) || null}
            stages={stages}
            onMoveStage={onDealMoved}
            onEdit={onEditDeal}
            onOpenQuotations={onOpenQuotations}
          />
        ))}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-muted-foreground text-sm">
            {c('dealPage', { page: current + 1, pages, total })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              {c('previousDeals')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              {c('nextDeals')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
