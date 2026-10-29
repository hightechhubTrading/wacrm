'use client';

import { statusClasses } from '@/lib/ui-colors';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import {
  BriefcaseBusiness,
  UserRound,
  CircleDot,
  FileText,
  CalendarDays,
  ClipboardCheck,
  Factory,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useCan } from '@/hooks/use-can';
import { useSalesContext } from '@/hooks/use-sales-context';
import { nextSalesAction } from '@/lib/inbox/sales-context';
import { GroupWorkDialog } from '@/components/jobs/group-work';
import { QuotationsDialog } from '@/components/pipelines/quotations-dialog';
import type { Deal, Conversation } from '@/types';
import type { Quotation } from '@/lib/quotations/types';
import { CustomFieldGroupFields } from '@/components/custom-fields/custom-field-group-fields';
import type { GroupWork } from '@/lib/jobs/workflow';
export function NextSalesAction({
  conversation,
  onOpenJob,
  onReply,
  sessionExpired,
}: {
  conversation: Conversation;
  onOpenJob?: () => void;
  onReply?: () => void;
  sessionExpired?: boolean;
}) {
  const t = useTranslations('Inbox.sales');
  const ft = useTranslations('Inbox.followups');
  const jt = useTranslations('Jobs');
  const locale = useLocale();
  const ctx = useSalesContext(
    `${conversation.id}|${conversation.last_message_at ?? ''}`
  );
  const [workDeal, setWorkDeal] = useState<string | null>(null);
  const facts = ctx.data[conversation.id];
  if (!ctx.available) return null;
  const action = facts ? nextSalesAction(facts, conversation.status) : null;
  function openFollowups() {
    window.dispatchEvent(
      new CustomEvent('open-sales-followups', {
        detail: { conversationId: conversation.id },
      })
    );
  }
  return (
    <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="me-2 font-semibold">{t('nextAction')}</span>
        {ctx.error ? (
          t('unavailable')
        ) : !action ? (
          t('loading')
        ) : action.kind === 'reply' ? (
          t('replyNeeded')
        ) : action.kind === 'closed' ? (
          t('closed')
        ) : action.kind === 'none' ? (
          t('noAction')
        ) : action.kind === 'waiting' ? (
          t('waitingHint')
        ) : action.kind === 'followup' ? (
          <span>
            {ft(`kinds.${action.task.kind}`)} ·{' '}
            {new Date(action.task.due_at).toLocaleString(locale)} ·{' '}
            {action.task.owner_name ?? t('ownerNotSet')}
          </span>
        ) : (
          <span>
            HTH-{action.work.reference} · {jt(`statuses.${action.work.status}`)}
            {action.work.responsible ? ` · ${action.work.responsible}` : ''}
            {action.work.due_at
              ? ` · ${new Date(action.work.due_at).toLocaleString(locale)}`
              : ''}
          </span>
        )}
      </div>
      {onOpenJob && (
        <Button
          size="sm"
          variant="outline"
          className="lg:hidden"
          onClick={onOpenJob}
        >
          {t('job')}
        </Button>
      )}
      {action?.kind === 'reply' && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onReply
              ? onReply()
              : window.dispatchEvent(new Event('focus-sales-composer'))
          }
        >
          {t(sessionExpired ? 'sendTemplate' : 'writeReply')}
        </Button>
      )}
      {action?.kind === 'followup' && (
        <Button size="sm" variant="outline" onClick={openFollowups}>
          {t('openFollowup')}
        </Button>
      )}
      {action?.kind === 'work' && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setWorkDeal(action.work.deal_id)}
        >
          {action.work.status === 'draft'
            ? t('prepareGroup')
            : t('recordUpdate')}
        </Button>
      )}
      {workDeal && (
        <GroupWorkDialog
          key={`${conversation.id}-${workDeal}`}
          dealId={workDeal}
          onClose={() => setWorkDeal(null)}
        />
      )}
    </div>
  );
}
export function DealSalesPanel({
  deals,
  contactId,
  selectedDealId,
  onSelectDeal,
}: {
  deals: Deal[];
  contactId: string;
  selectedDealId?: string;
  onSelectDeal?: (id: string) => void;
}) {
  const t = useTranslations('Inbox.sales');
  const jt = useTranslations('Jobs');
  const locale = useLocale();
  const canEdit = useCan('send-messages');
  const validDeals = deals.filter((d) => d.contact_id === contactId);
  const [selected, setSelected] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [initialKind, setInitialKind] = useState<'measurement' | 'workshop'>(
    'measurement'
  );
  const [groupView, setGroupView] = useState<'prepare' | 'report'>('prepare');
  const [quotesOpen, setQuotesOpen] = useState(false);
  const selectedId =
    (selectedDealId ?? selected) ||
    (validDeals.length === 1 ? validDeals[0].id : '');
  const deal = validDeals.find((d) => d.id === selectedId);
  const [state, setState] = useState<{
    dealId: string;
    work: GroupWork[];
    quote: Quotation | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!selectedId || !canEdit) return;
    const controller = new AbortController();
    let seq = 0;
    async function load() {
      const current = ++seq;
      try {
        const [work, quotes] = await Promise.all([
          fetch(`/api/jobs/${selectedId}`, { signal: controller.signal }),
          fetch(`/api/quotations?dealId=${selectedId}`, {
            signal: controller.signal,
          }),
        ]);
        if (!work.ok || !quotes.ok) throw new Error('load');
        const [w, q] = await Promise.all([work.json(), quotes.json()]);
        if (!controller.signal.aborted && current === seq)
          setState({
            dealId: selectedId,
            work: w.work,
            quote: q[0] ?? null,
            error: false,
          });
      } catch {
        if (!controller.signal.aborted && current === seq)
          setState({ dealId: selectedId, work: [], quote: null, error: true });
      }
    }
    void load();
    const refresh = () => void load();
    window.addEventListener('group-work-updated', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('group-work-updated', refresh);
    };
  }, [selectedId, canEdit]);
  if (!canEdit) return null;
  const current = state?.dealId === selectedId ? state : null;
  return (
    <section className="crm-sales-card" data-tone="blue">
      <header className="crm-customer-section-title">
        <BriefcaseBusiness size={18} aria-hidden />
        <h3>{t('jobPanel')}</h3>
      </header>
      <Label htmlFor={`sales-job-${contactId}`}>{t('selectedJob')}</Label>
      <select
        id={`sales-job-${contactId}`}
        className="crm-sales-job-select bg-background w-full rounded border p-2 text-sm"
        value={selectedId}
        onChange={(e) => {
          setSelected(e.target.value);
          onSelectDeal?.(e.target.value);
          setGroupOpen(false);
          setQuotesOpen(false);
        }}
      >
        <option value="">{t('chooseJob')}</option>
        {validDeals.map((d) => (
          <option value={d.id} key={d.id}>
            {d.title}
          </option>
        ))}
      </select>
      {!validDeals.length ? (
        <p className="text-muted-foreground text-sm">{t('noJobs')}</p>
      ) : !deal ? (
        <p className="text-muted-foreground text-sm">{t('chooseHint')}</p>
      ) : (
        <>
          <div className="crm-sales-value">
            <span>{t('dealValue')}</span>
            <strong dir="auto">
              {deal.value.toLocaleString(locale)} {deal.currency}
            </strong>
          </div>
          <dl className="crm-sales-facts">
            <div>
              <dt>
                <CircleDot size={14} aria-hidden />
                {t('stage')}
              </dt>
              <dd>
                {deal.stage?.name ??
                  t(`dealStatuses.${deal.status ?? 'unknown'}`)}
              </dd>
            </div>
            <div>
              <dt>
                <UserRound size={14} aria-hidden />
                {t('owner')}
              </dt>
              <dd>{deal.assignee?.full_name ?? t('ownerNotSet')}</dd>
            </div>
          </dl>
          {current?.error ? (
            <p role="alert" className="text-sm">
              {t('unavailable')}
            </p>
          ) : !current ? (
            <p className="text-sm">{t('loading')}</p>
          ) : (
            <>
              <div className="crm-sales-quotation" data-tone="green">
                <FileText size={18} aria-hidden />
                <div>
                  <span>{t('latestQuotation')}</span>
                  {current.quote ? (
                    <Link
                      className="underline"
                      href={`/quotations/${current.quote.id}`}
                    >
                      {current.quote.reference} · rev {current.quote.revision} ·{' '}
                      <span className={statusClasses(current.quote.status)}>
                        {t(`quotationStatuses.${current.quote.status}`)}
                      </span>
                    </Link>
                  ) : (
                    t('noQuotation')
                  )}
                </div>
              </div>
              {current.work
                .filter(
                  (w) =>
                    !['report_received', 'installed', 'cancelled'].includes(
                      w.status
                    )
                )
                .slice(0, 3)
                .map((w) => (
                  <div className="crm-active-job" key={w.id}>
                    <ClipboardCheck size={17} aria-hidden />
                    <div>
                      <strong>
                        HTH-{w.reference} · {jt(`kinds.${w.kind}`)}
                      </strong>
                      <span>
                        {jt(`statuses.${w.status}`)}
                        {w.due_at
                          ? ` · ${new Date(w.due_at).toLocaleDateString(locale)}`
                          : ''}
                      </span>
                    </div>
                  </div>
                ))}
            </>
          )}
          <details className="crm-sales-requirements">
            <summary>
              <Layers size={16} aria-hidden />
              {t('requirements')}
            </summary>
            <CustomFieldGroupFields
              scope="deal"
              recordId={deal.id}
              editable={deal.status === 'open'}
              className="mt-2"
            />
            {deal.notes && (
              <p className="mt-2 text-sm whitespace-pre-wrap">{deal.notes}</p>
            )}
          </details>
          <div className="crm-sales-actions">
            <Button
              size="sm"
              variant="outline"
              data-tone="blue"
              onClick={() => {
                setInitialKind('measurement');
                setGroupView('prepare');
                setGroupOpen(true);
              }}
            >
              <CalendarDays size={19} aria-hidden /> {t('requestVisit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tone="amber"
              onClick={() => {
                setInitialKind('measurement');
                setGroupView('report');
                setGroupOpen(true);
              }}
            >
              <ClipboardCheck size={19} aria-hidden /> {t('addReport')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tone="violet"
              onClick={() => {
                setInitialKind('workshop');
                setGroupView('prepare');
                setGroupOpen(true);
              }}
            >
              <Factory size={19} aria-hidden /> {t('requestWorkshop')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tone="green"
              onClick={() => setQuotesOpen(true)}
            >
              <FileText size={19} aria-hidden /> {t('quotations')}
            </Button>
          </div>
          <p className="crm-customer-hint">{t('groupHint')}</p>
          {groupOpen && (
            <GroupWorkDialog
              key={deal.id}
              dealId={deal.id}
              initialKind={initialKind}
              initialView={groupView}
              onClose={() => setGroupOpen(false)}
            />
          )}
          {quotesOpen && (
            <QuotationsDialog
              open
              onOpenChange={setQuotesOpen}
              dealId={deal.id}
              contactId={contactId}
            />
          )}
        </>
      )}
    </section>
  );
}
