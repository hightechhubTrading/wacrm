'use client';
import { BUSINESS_TIME_ZONE, formatBusinessDate } from '@/lib/business-time';

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
import {
  jobHistory,
  latestMeasurement,
  nextJobWork,
  type OverviewWork,
} from '@/lib/inbox/job-overview';
import { BusinessTimeNote } from '@/components/workspace/business-time-note';
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
            {new Date(action.task.due_at).toLocaleString(locale, {
              timeZone: BUSINESS_TIME_ZONE,
            })}{' '}
            · {action.task.owner_name ?? t('ownerNotSet')}
          </span>
        ) : (
          <span>
            HTH-{action.work.reference} · {jt(`statuses.${action.work.status}`)}
            {action.work.responsible ? ` · ${action.work.responsible}` : ''}
            {action.work.due_at
              ? ` · ${new Date(action.work.due_at).toLocaleString(locale, { timeZone: BUSINESS_TIME_ZONE })}`
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
  const [groupOpen, setGroupOpen] = useState<string | null>(null);
  const [initialKind, setInitialKind] = useState<'measurement' | 'workshop'>(
    'measurement'
  );
  const [groupView, setGroupView] = useState<'overview' | 'prepare' | 'report'>(
    'prepare'
  );
  const [quotesOpen, setQuotesOpen] = useState<string | null>(null);
  const [historyWorkId, setHistoryWorkId] = useState<string>();
  const selectedId =
    (selectedDealId ?? selected) ||
    (validDeals.length === 1 ? validDeals[0].id : '');
  const deal = validDeals.find((d) => d.id === selectedId);
  const permittedDealId = deal?.id;
  const [state, setState] = useState<{
    dealId: string;
    work: OverviewWork[];
    quotes: Quotation[];
    acceptedError: boolean;
    quote: Quotation | null;
    accepted: { id: string; reference: string; revision: number } | null;
    workError: boolean;
    quoteError: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!permittedDealId || !canEdit) return;
    const controller = new AbortController();
    let seq = 0;
    async function load() {
      const current = ++seq;
      const read = async (url: string) => {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('load');
        return response.json();
      };
      const [work, quotes] = await Promise.allSettled([
        read(`/api/jobs/${selectedId}?overview=1`),
        read(`/api/quotations?dealId=${selectedId}&pageSize=25`),
      ]);
      if (controller.signal.aborted || current !== seq) return;
      setState({
        dealId: selectedId,
        work: work.status === 'fulfilled' ? work.value.work : [],
        acceptedError:
          work.status === 'rejected' || !!work.value.quotationsError,
        quotes: quotes.status === 'fulfilled' ? quotes.value : [],
        accepted:
          work.status === 'fulfilled'
            ? (work.value.quotations?.[0] ?? null)
            : null,
        quote: quotes.status === 'fulfilled' ? (quotes.value[0] ?? null) : null,
        workError: work.status === 'rejected' || !!work.value.workError,
        quoteError: quotes.status === 'rejected',
      });
    }
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('group-work-updated', refresh);
    window.addEventListener('quotations-updated', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('group-work-updated', refresh);
      window.removeEventListener('quotations-updated', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [selectedId, permittedDealId, canEdit, reload, contactId]);
  if (!canEdit) return null;
  const current = state?.dealId === selectedId ? state : null;
  const history = current ? jobHistory(current.work, current.quotes) : [];
  const measurement = current ? latestMeasurement(current.work) : null;
  const nextWork = current ? nextJobWork(current.work) : null;
  const openWork = (work: OverviewWork) => {
    setInitialKind(work.kind);
    setHistoryWorkId(work.id);
    setGroupView('overview');
    setGroupOpen(selectedId);
  };
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
          setGroupOpen(null);
          setQuotesOpen(null);
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
          {!current ? (
            <p className="text-sm">{t('loading')}</p>
          ) : (
            <>
              <div className="crm-sales-quotation" data-tone="green">
                <FileText size={18} aria-hidden />
                <div>
                  <span>{t('latestQuotation')}</span>
                  {current.quoteError ? (
                    <p role="alert">{t('unavailable')}</p>
                  ) : current.quote ? (
                    <Link
                      className="inline-flex min-h-11 items-center underline"
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
              {current.acceptedError ? (
                <p role="alert" className="text-sm">
                  {t('unavailable')}
                </p>
              ) : (
                <div className="mt-2 text-sm">
                  <span>{t('acceptedQuotation')}: </span>
                  {current.accepted ? (
                    <Link
                      className="inline-flex min-h-11 items-center underline"
                      href={`/quotations/${current.accepted.id}`}
                    >
                      {current.accepted.reference} · rev{' '}
                      {current.accepted.revision}
                    </Link>
                  ) : (
                    t('noAcceptedQuotation')
                  )}
                </div>
              )}
              {current.work.some((work) => work.status === 'blocked') && (
                <p role="status" className="mt-2 text-sm">
                  {t('workBlocked')}
                </p>
              )}
              {(current.workError ||
                current.quoteError ||
                current.acceptedError) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReload((value) => value + 1)}
                >
                  {t('retryOverview')}
                </Button>
              )}
              {!current.workError && (
                <div className="my-3 space-y-2 text-sm">
                  <p className="font-medium">{t('nextAction')}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      nextWork
                        ? openWork(nextWork)
                        : measurement
                          ? openWork(measurement.work)
                          : setQuotesOpen(selectedId)
                    }
                  >
                    {nextWork
                      ? t(
                          nextWork.status === 'blocked'
                            ? 'reviewBlocker'
                            : 'reviewWork'
                        )
                      : measurement
                        ? t('reviewMeasurement')
                        : t('quotations')}
                  </Button>
                  {measurement && (
                    <div>
                      <strong>{t('measurementResult')}</strong>
                      <p className="whitespace-pre-wrap" dir="auto">
                        {measurement.event.note || t('measurementEvidence')}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <details className="mt-3 text-sm">
                <summary className="min-h-11 cursor-pointer py-3">
                  {t('jobHistory')}
                </summary>
                <p className="text-muted-foreground my-2">
                  {t('jobHistoryHint')}
                </p>
                {(current.workError || current.quoteError) && (
                  <p role="alert">{t('historyPartial')}</p>
                )}
                {!history.length &&
                  !current.workError &&
                  !current.quoteError && <p>{t('noJobHistory')}</p>}
                <ol className="space-y-3">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      {entry.kind === 'quotation' ? (
                        <>
                          <Link
                            className="block min-h-11 py-2 underline"
                            href={`/quotations/${entry.quote.id}`}
                          >
                            {entry.quote.reference} · rev {entry.quote.revision}
                          </Link>
                          <p>
                            {t('quotationCreated')} ·{' '}
                            {t('currentQuotationStatus', {
                              status: t(
                                `quotationStatuses.${entry.quote.status}`
                              ),
                            })}
                          </p>
                        </>
                      ) : (
                        <>
                          <button
                            className="min-h-11 py-2 text-start underline"
                            onClick={() => openWork(entry.work)}
                          >
                            HTH-{entry.work.reference} ·{' '}
                            {jt(`kinds.${entry.work.kind}`)} ·{' '}
                            {entry.event
                              ? jt(`statuses.${entry.event.status}`)
                              : t('workCreated')}
                          </button>
                          {entry.event?.note && (
                            <p className="whitespace-pre-wrap" dir="auto">
                              {entry.event.note}
                            </p>
                          )}
                          {entry.event && (
                            <p className="text-muted-foreground">
                              {t('staffRecordedUpdate')}
                            </p>
                          )}
                        </>
                      )}
                      <time
                        className="text-muted-foreground block"
                        dateTime={entry.at}
                      >
                        {formatBusinessDate(entry.at, locale)}
                      </time>
                    </li>
                  ))}
                </ol>
              </details>
              <BusinessTimeNote />
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
                      <button
                        className="min-h-11 py-2 text-start font-semibold underline"
                        onClick={() => openWork(w)}
                      >
                        HTH-{w.reference} · {jt(`kinds.${w.kind}`)}
                      </button>
                      <span>
                        {jt(`statuses.${w.status}`)}
                        {w.due_at
                          ? ` · ${jt('requestedDate')}: ${formatBusinessDate(w.due_at, locale)}`
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
            <p className="text-muted-foreground mt-2 text-xs">
              {t('requirementsHint')}
            </p>
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
                setHistoryWorkId(undefined);
                setInitialKind('measurement');
                setGroupView('prepare');
                setGroupOpen(selectedId);
              }}
            >
              <CalendarDays size={19} aria-hidden /> {t('requestVisit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tone="amber"
              onClick={() => {
                setHistoryWorkId(undefined);
                setInitialKind('measurement');
                setGroupView('report');
                setGroupOpen(selectedId);
              }}
            >
              <ClipboardCheck size={19} aria-hidden /> {t('addReport')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tone="violet"
              onClick={() => {
                setHistoryWorkId(undefined);
                setInitialKind('workshop');
                setGroupView('prepare');
                setGroupOpen(selectedId);
              }}
            >
              <Factory size={19} aria-hidden /> {t('requestWorkshop')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tone="green"
              onClick={() => setQuotesOpen(selectedId)}
            >
              <FileText size={19} aria-hidden /> {t('quotations')}
            </Button>
          </div>
          <p className="crm-customer-hint">{t('groupHint')}</p>
          {groupOpen === deal.id && (
            <GroupWorkDialog
              key={deal.id}
              dealId={deal.id}
              initialKind={initialKind}
              initialWorkId={historyWorkId}
              initialView={groupView}
              onClose={() => setGroupOpen(null)}
            />
          )}
          {quotesOpen === deal.id && (
            <QuotationsDialog
              open
              onOpenChange={(open) => setQuotesOpen(open ? deal.id : null)}
              dealId={deal.id}
              contactId={contactId}
            />
          )}
        </>
      )}
    </section>
  );
}
