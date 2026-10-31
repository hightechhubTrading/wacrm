'use client';

import { memo, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { DealAssignment } from './deal-assignment';
import { GroupWorkButton } from '@/components/jobs/group-work';
import type { Deal, PipelineStage } from '@/types';
import {
  ArrowUpRight,
  Calendar,
  Check,
  CircleAlert,
  FileText,
  X,
  Sparkles,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import { getPipelineOwner } from '@/lib/pipelines/deal-owner';
import { dateKey, isOverdue } from '@/lib/pipelines/deal-views';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useLocale, useTranslations } from 'next-intl';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  onOpenQuotations: (deal: Deal) => void;
  stages?: PipelineStage[];
  onMoveStage?: (dealId: string, stageId: string) => void;
  dragHandle?: ReactNode;
  isOverlay?: boolean;
}

export const DealCard = memo(function DealCard({
  deal,
  stage,
  onEdit,
  onOpenQuotations,
  stages,
  onMoveStage,
  dragHandle,
  isOverlay,
}: DealCardProps) {
  const t = useTranslations('Pipelines.explorer');
  const c = useTranslations('Pipelines.smartCard');
  const locale = useLocale();
  const { profile, accountRole } = useAuth();
  const canWrite = useCan('send-messages');
  const canMove =
    canWrite &&
    (accountRole === 'owner' ||
      accountRole === 'admin' ||
      (!!profile?.id && deal.assigned_to === profile.id));
  const customer = deal.contact?.name || deal.contact?.phone || t('noContact');
  const status = deal.status || 'open';
  const overdue = isOverdue(deal);
  const dueToday =
    status === 'open' && deal.expected_close_date === dateKey(new Date());
  const attention =
    status !== 'open'
      ? status
      : overdue
        ? 'late'
        : dueToday
          ? 'today'
          : !getPipelineOwner(deal).id
            ? 'owner'
            : !deal.expected_close_date
              ? 'date'
              : 'scheduled';
  const needsAttention = ['late', 'today', 'owner', 'date'].includes(attention);
  const tags = deal.contact?.tags || [];
  const conversationId =
    deal.conversation_id ||
    deal.customerConversationId ||
    deal.aiSummary?.conversationId;
  const date = deal.expected_close_date
    ? new Date(`${deal.expected_close_date}T12:00:00`).toLocaleDateString(
        locale,
        { month: 'short', day: 'numeric' }
      )
    : c('noDate');
  return (
    <article
      className="crm-deal-card crm-smart-deal"
      data-attention={needsAttention ? attention : undefined}
      data-card-state={attention}
    >
      <div className="crm-smart-deal-top">
        <span className="crm-smart-stage-chip">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: stage?.color || 'var(--ui-info)' }}
          />
          <span>{stage?.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="crm-smart-state-label">
            {status === 'won' ? (
              <Check className="size-3.5" />
            ) : status === 'lost' ? (
              <X className="size-3.5" />
            ) : needsAttention ? (
              <CircleAlert className="size-3.5" />
            ) : (
              <Calendar className="size-3.5" />
            )}
            {c(`state_${attention}`)}
          </span>
          {dragHandle}
        </div>
      </div>
      <button
        type="button"
        disabled={isOverlay}
        onClick={() => onEdit(deal)}
        className="crm-smart-deal-main"
        aria-label={t('openDeal', { title: deal.title })}
      >
        <span className="crm-smart-customer">
          <span className="crm-smart-avatar">
            {customer.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {customer}
            </span>
            <span
              className="text-muted-foreground mt-0.5 block text-xs"
              dir="auto"
            >
              {deal.contact?.name ? deal.contact?.phone : c('customer')}
            </span>
          </span>
          <ArrowUpRight className="text-muted-foreground ms-auto size-4 shrink-0 rtl:-rotate-90" />
        </span>
        <span className="crm-smart-title">{deal.title}</span>
        <span className="crm-smart-tags">
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="crm-colored-tag"
              style={{
                color: 'var(--foreground)',
                backgroundColor: `color-mix(in srgb, ${tag.color} 12%, var(--card))`,
                borderColor: `color-mix(in srgb, ${tag.color} 30%, var(--border))`,
              }}
            >
              <i style={{ backgroundColor: tag.color }} />
              {tag.name}
            </span>
          ))}
          {tags.length > 2 && (
            <span
              title={tags
                .slice(2)
                .map((tag) => tag.name)
                .join(', ')}
            >
              {t('moreTags', { count: tags.length - 2 })}
            </span>
          )}
        </span>
      </button>
      <DealAiSummary deal={deal} />
      <span
        className="crm-smart-attention"
        data-urgent={overdue || dueToday || undefined}
      >
        {status === 'won' ? (
          <Check className="size-4 shrink-0" />
        ) : status === 'lost' ? (
          <X className="size-4 shrink-0" />
        ) : needsAttention ? (
          <CircleAlert className="size-4 shrink-0" />
        ) : (
          <Calendar className="size-4 shrink-0" />
        )}
        <span>
          <span className="block text-sm font-medium">
            {c(`attention_${attention}`)}
          </span>
          <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
            {c(`hint_${attention}`)}
          </span>
        </span>
      </span>
      {deal.contact?.customValues?.length ? (
        <details className="crm-smart-details">
          <summary>
            {c('details', { count: deal.contact.customValues.length })}
          </summary>
          <dl>
            {deal.contact.customValues.map((field) => (
              <div key={field.field_name}>
                <dt>{field.field_name}</dt>
                <dd dir="auto">{field.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      <div className="crm-smart-meta">
        <DealAssignment deal={deal} />
        <span className={overdue ? 'text-destructive' : ''}>
          <Calendar className="size-3.5 shrink-0" />
          {date}
        </span>
      </div>
      {!isOverlay && onMoveStage && stages && (
        <label className="crm-smart-stage">
          <span className="sr-only">
            {t('moveDeal', { title: deal.title })}
          </span>
          <select
            aria-label={t('moveDeal', { title: deal.title })}
            value={deal.stage_id}
            disabled={!canMove}
            onChange={(event) => onMoveStage(deal.id, event.target.value)}
          >
            {stages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!isOverlay && (
        <div className="crm-smart-actions">
          {conversationId && (
            <Link
              className="crm-deal-conversation-action"
              href={`/inbox?c=${encodeURIComponent(conversationId)}`}
            >
              <MessageSquare className="size-4" />
              {c('conversationAction')}
            </Link>
          )}
          <div className="crm-deal-work-action">
            <GroupWorkButton dealId={deal.id} />
          </div>
          <button
            type="button"
            className="crm-deal-quotation-action"
            onClick={() => onOpenQuotations(deal)}
          >
            <FileText className="size-3.5" />
            {c('quotations')}
          </button>
        </div>
      )}
    </article>
  );
});

export function DealAiSummary({
  deal,
  compact = false,
}: {
  deal: Deal;
  compact?: boolean;
}) {
  const c = useTranslations('Pipelines.smartCard');
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section
      className={
        compact
          ? 'crm-list-ai-summary crm-glass-summary'
          : 'crm-card-ai-summary crm-glass-summary'
      }
      data-summary-state={
        deal.aiSummary
          ? 'available'
          : deal.aiSummaryUnavailable
            ? 'unavailable'
            : 'pending'
      }
      aria-label={c('aiSummary')}
    >
      <button
        type="button"
        className="crm-glass-summary-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="crm-glass-summary-icon">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1 text-start">
          <span className="block text-xs font-semibold">{c('aiSummary')}</span>
          <span className="text-muted-foreground mt-0.5 block text-[11px]">
            {c(
              expanded
                ? 'collapseSummary'
                : deal.aiSummary
                  ? 'expandSummary'
                  : 'summaryPending'
            )}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={id} hidden={!expanded} className="crm-glass-summary-body">
        <p dir="auto">
          {deal.aiSummary?.text ||
            c(deal.aiSummaryUnavailable ? 'summaryUnavailable' : 'noSummary')}
        </p>
      </div>
    </section>
  );
}
