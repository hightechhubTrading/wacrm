'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Deal, PipelineStage } from '@/types';
import { DealCard } from './deal-card';
import { Button } from '@/components/ui/button';
import { Plus, GripVertical, ArrowLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useTranslations } from 'next-intl';

const CARDS_PER_STAGE_PAGE = 6;

const detectStage: CollisionDetection = (args) => {
  return args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);
};
const scrollOptions = {
  acceleration: 8,
  threshold: { x: 0.12, y: 0.1 },
  canScroll: (element: Element) =>
    element.classList.contains('pipeline-scroll'),
};
interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  onOpenQuotations,
}: PipelineBoardProps) {
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor)
  );

  const activeDeal = activeDealId
    ? (deals.find((d) => d.id === activeDealId) ?? null)
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detectStage}
      autoScroll={scrollOptions}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        data-dragging={!!activeDealId}
        className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none"
      >
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              stages={sortedStages}
              deals={stageDeals}
              dragging={!!activeDealId}
              onDealMoved={onDealMoved}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              onOpenQuotations={onOpenQuotations}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={null} adjustScale={false}>
        {activeDeal ? (
          <div className="crm-deal-drag-preview">
            <span>{activeDeal.contact?.name || activeDeal.contact?.phone}</span>
            <strong>{activeDeal.title}</strong>
            {activeDeal.aiSummary?.text && (
              <p dir="auto">{activeDeal.aiSummary.text}</p>
            )}
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: auto;
          overflow-anchor: none;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  stages,
  deals,
  dragging,
  onAddDeal,
  onDealMoved,
  onEditDeal,
  onOpenQuotations,
}: {
  stage: PipelineStage;
  stages: PipelineStage[];
  deals: Deal[];
  dragging: boolean;
  onAddDeal: (stageId: string) => void;
  onDealMoved: (dealId: string, stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
}) {
  const t = useTranslations('Pipelines.board');
  const c = useTranslations('Pipelines.smartCard');
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(deals.length / CARDS_PER_STAGE_PAGE));
  const current = Math.min(page, pages - 1);
  // Keep all records available to search and counts, but only mount this page's
  // interactive cards and drag subscriptions.
  const shown = deals.slice(
    current * CARDS_PER_STAGE_PAGE,
    (current + 1) * CARDS_PER_STAGE_PAGE
  );
  const canCreate = useCan('send-messages');
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`crm-stage-column ${isOver ? 'crm-stage-over' : ''} border-border bg-card/60 flex w-[88vw] max-w-[400px] min-w-[min(88vw,360px)] shrink-0 snap-start flex-col rounded-xl border p-4 lg:w-[360px] lg:min-w-[360px] lg:flex-1 lg:snap-none`}
    >
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="text-foreground truncate text-sm font-semibold">
          {stage.name}
        </h3>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
          {deals.length}
        </span>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <p role="status" className="text-muted-foreground text-xs">
            {c('dealPage', { page: current + 1, pages, total: deals.length })}
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`${c('previousDeals')} · ${stage.name}`}
              disabled={dragging || current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ArrowLeft className="size-4 rtl:rotate-180" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`${c('nextDeals')} · ${stage.name}`}
              disabled={dragging || current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}

      <div
        className={`mt-3 flex flex-1 flex-col gap-3 rounded-lg ${
          isOver
            ? 'bg-primary/5 outline-primary outline outline-2 outline-offset-2 outline-dashed'
            : ''
        }`}
      >
        {deals.length === 0 ? (
          <div className="border-border text-muted-foreground flex flex-1 items-center justify-center rounded-lg border-2 border-dashed py-10 text-xs">
            {t('dropDealHere')}
          </div>
        ) : (
          shown.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              stages={stages}
              onMoveStage={onDealMoved}
              onEdit={onEditDeal}
              onOpenQuotations={onOpenQuotations}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={!canCreate}
        onClick={() => onAddDeal(stage.id)}
        className="border-border text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground mt-3 w-full justify-start border border-dashed bg-transparent"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t('addDeal')}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  stages,
  onMoveStage,
  onEdit,
  onOpenQuotations,
}: {
  deal: Deal;
  stage: PipelineStage;
  stages: PipelineStage[];
  onMoveStage: (dealId: string, stageId: string) => void;
  onEdit: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
}) {
  const copy = useTranslations('Pipelines.smartCard');
  const { profile, accountRole } = useAuth();
  const canWrite = useCan('send-messages');
  const canMove =
    canWrite &&
    (accountRole === 'owner' ||
      accountRole === 'admin' ||
      (!!profile?.id && deal.assigned_to === profile.id));
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !canMove,
  });

  const dragHandle = useMemo(
    () =>
      canMove ? (
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label={copy('drag', { title: deal.title })}
          className="crm-deal-drag-handle"
        >
          <GripVertical className="size-4" />
        </button>
      ) : undefined,
    [canMove, listeners, attributes, copy, deal.title]
  );
  return (
    <div
      ref={setNodeRef}
      style={{
        opacity: isDragging ? 0.3 : 1,
      }}
    >
      <DealCard
        deal={deal}
        stage={stage}
        stages={stages}
        onMoveStage={onMoveStage}
        dragHandle={dragHandle}
        onEdit={onEdit}
        onOpenQuotations={onOpenQuotations}
      />
    </div>
  );
}
