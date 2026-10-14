'use client';

import { GroupWorkButton } from '@/components/jobs/group-work';
import type { Deal, PipelineStage } from '@/types';
import { Calendar, Check, FileText, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useLocale, useTranslations } from 'next-intl';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || '?').trim();
  if (!source) return '?';
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  onOpenQuotations,
  isOverlay,
}: DealCardProps) {
  const t = useTranslations('Pipelines.card');
  const locale = useLocale();
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t('noContact');
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    // A `<button>` (the Quotations trigger below) can't nest inside another
    // `<button>` (the main card) -- that's invalid HTML and causes a
    // hydration mismatch. This wrapping div carries the card's visual
    // chrome (border/bg/shadow/hover) so the two triggers can sit as
    // siblings inside it instead.
    <div
      className={`crm-deal-card group border-border/50 bg-muted/70 relative w-full overflow-hidden rounded-xl border shadow-sm transition-all ${
        isOverlay
          ? 'shadow-xl'
          : 'hover:border-border hover:bg-muted hover:-translate-y-0.5 hover:shadow-lg'
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute start-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <button
        type="button"
        onClick={(e) => {
          // `onClick` still fires after a non-drag tap because the PointerSensor
          // requires 5px movement before it counts as a drag.
          if (isOverlay) return;
          e.stopPropagation();
          onEdit(deal);
        }}
        className="block w-full cursor-pointer ps-4 pe-3 pt-3 pb-2 text-start"
      >
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-foreground flex-1 text-sm leading-snug font-semibold break-words">
            {deal.title}
          </h4>
          {deal.status === 'won' && (
            <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
              <Check className="h-3 w-3" />
              {t('won')}
            </span>
          )}
          {deal.status === 'lost' && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <X className="h-3 w-3" />
              {t('lost')}
            </span>
          )}
        </div>

        {deal.contact?.tags && deal.contact.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {deal.contact.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {deal.contact?.customValues && deal.contact.customValues.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {deal.contact.customValues.slice(0, 2).map((cv) => (
              <p
                key={cv.field_name}
                className="text-muted-foreground truncate text-[11px]"
              >
                <span className="text-foreground/80 font-medium">
                  {cv.field_name}:
                </span>{' '}
                {cv.value}
              </p>
            ))}
          </div>
        )}

        {/* Contact row */}
        <div className="mt-2 flex items-center gap-2">
          <span className="bg-muted text-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {contactLabel}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="crm-deal-value text-foreground text-xl font-semibold tabular-nums">
            {formatCurrency(deal.value, deal.currency)}
          </span>
          {deal.expected_close_date && (
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Calendar className="h-3 w-3" />
              {formatDate(deal.expected_close_date, locale)}
            </span>
          )}
        </div>

        {assigneeLabel && (
          <div className="mt-2 flex items-center justify-end">
            <span
              title={assigneeLabel}
              className="bg-primary/15 text-primary flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
            >
              {initials(assigneeLabel)}
            </span>
          </div>
        )}
      </button>

      {!isOverlay && <GroupWorkButton dealId={deal.id} />}

      {/* Quotations entry point (Task 14) -- sibling of the main card
          button, not nested inside it. Same isOverlay guard as onEdit
          above: the drag-preview clone renders this too but never fires. */}
      <button
        type="button"
        onClick={(e) => {
          if (isOverlay) return;
          e.stopPropagation();
          onOpenQuotations(deal);
        }}
        className="border-border/50 text-muted-foreground hover:text-primary flex w-full items-center gap-1.5 border-t px-4 py-2 text-[11px] font-medium transition-colors"
      >
        <FileText className="h-3 w-3" />
        {t('quotations')}
      </button>
    </div>
  );
}
