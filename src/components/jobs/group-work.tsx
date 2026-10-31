'use client';
import { BusinessTimeNote } from '@/components/workspace/business-time-note';
import { BUSINESS_TIME_ZONE, businessDateTimeToIso } from '@/lib/business-time';

import { statusClasses } from '@/lib/ui-colors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Clipboard, MessagesSquare, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  groupMessage,
  nextStatus,
  needsEvidence,
  type GroupWork,
  type WorkEvent,
  type WorkAction,
  type WorkKind,
} from '@/lib/jobs/workflow';
import { useCan } from '@/hooks/use-can';
type Work = GroupWork & { events: WorkEvent[] };
type Data = {
  deal: {
    title: string;
    contact: { name: string | null; phone: string | null } | null;
  };
  work: Work[];
  quotations: { id: string; reference: string; revision: number }[];
};
const actions: WorkAction[] = [
  'posted',
  'started',
  'report',
  'ready',
  'installed',
  'blocked',
  'update',
  'cancelled',
];
function announce() {
  window.dispatchEvent(new Event('group-work-updated'));
}
export function GroupWorkButton({ dealId }: { dealId: string }) {
  const t = useTranslations('Jobs');
  const canEdit = useCan('send-messages');
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="border-border/50 text-muted-foreground hover:text-primary flex w-full items-center gap-1.5 border-t px-4 py-2 text-[11px] font-medium"
      >
        <MessagesSquare className="h-3 w-3" />
        {t('title')}
      </button>
      {open && (
        <GroupWorkDialog
          key={dealId}
          dealId={dealId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function GroupWorkDialog({
  dealId,
  onClose,
  initialKind = 'measurement',
  initialView = 'overview',
  initialWorkId,
}: {
  dealId: string;
  onClose: () => void;
  initialKind?: WorkKind;
  initialView?: 'overview' | 'prepare' | 'report';
  initialWorkId?: string;
}) {
  const t = useTranslations('Jobs');
  const locale = useLocale();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<WorkKind>(initialKind);
  const [location, setLocation] = useState('');
  const [details, setDetails] = useState('');
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const [quotation, setQuotation] = useState('');
  const [view, setView] = useState(initialView);
  const [selectedWorkId, setSelectedWorkId] = useState(initialWorkId);
  const activeWork = data?.work.find(
    (work) => work.kind === kind && nextStatus(work, 'cancelled') !== null
  );
  const reports =
    data?.work.filter((work) => nextStatus(work, 'report') !== null) ?? [];
  const detailsRemaining = Math.max(0, 10 - details.trim().length);
  const dueIso = due ? businessDateTimeToIso(due) : null;
  const invalidDue =
    Boolean(due) && (!dueIso || Date.parse(dueIso) <= Date.now());
  const prepareBlocker = !location.trim()
    ? t('prepareNeedLocation')
    : detailsRemaining > 0
      ? t('prepareNeedDetails', { count: detailsRemaining })
      : kind === 'workshop' && !quotation
        ? t('prepareNeedQuotation')
        : invalidDue
          ? t('prepareNeedFutureDate')
          : null;
  const visibleWork =
    view === 'report'
      ? reports
      : (data?.work ?? []).filter(
          (work) => !selectedWorkId || work.id === selectedWorkId
        );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`/api/jobs/${dealId}`, { signal });
      if (!res.ok) throw new Error('load');
      const body = (await res.json()) as Data;
      if (!signal?.aborted) {
        setData(body);
        setFailed(false);
      }
    },
    [dealId]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [load]);
  async function create() {
    if (prepareBlocker) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${dealId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          location,
          details,
          responsible,
          due_at: dueIso,
          quotation_id: quotation || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await load();
      announce();
      setDetails('');
      setSelectedWorkId(undefined);
      setView('overview');
      toast.success(t('saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent className="crm-job-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {t('title')} · {data?.deal.title}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-5 p-4">
          <p className="text-muted-foreground text-sm">{t('explanation')}</p>
          {failed ? (
            <div role="alert">
              {t('error')}{' '}
              <Button
                onClick={() => void load().catch(() => toast.error(t('error')))}
              >
                {t('reload')}
              </Button>
            </div>
          ) : !data ? (
            <p>{t('loading')}</p>
          ) : (
            <>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label={t('viewLabel')}
              >
                {(['overview', 'prepare', 'report'] as const).map((value) => (
                  <Button
                    key={value}
                    variant={view === value ? 'default' : 'outline'}
                    className="h-auto min-h-11 px-2 py-2 whitespace-normal"
                    aria-pressed={view === value}
                    disabled={busy}
                    onClick={() => {
                      setSelectedWorkId(undefined);
                      setView(value);
                    }}
                  >
                    {t(`views.${value}`)}
                  </Button>
                ))}
              </div>
              {view === 'report' && (
                <p className="text-muted-foreground text-sm" role="status">
                  {reports.length ? t('reportContext') : t('noReportWork')}
                </p>
              )}
              {view === 'prepare' && (
                <section className="crm-job-card space-y-3 rounded-lg border p-3">
                  <h3 className="font-semibold">{t('newRequest')}</h3>
                  <div
                    className="grid gap-2 sm:grid-cols-2"
                    role="group"
                    aria-label={t('kind')}
                  >
                    {(['measurement', 'workshop'] as const).map((value) => (
                      <Button
                        key={value}
                        variant={kind === value ? 'default' : 'outline'}
                        className="h-auto min-h-11 px-3 py-2 whitespace-normal"
                        aria-pressed={kind === value}
                        disabled={busy}
                        onClick={() => setKind(value)}
                      >
                        {t(`kinds.${value}`)}
                      </Button>
                    ))}
                  </div>
                  {activeWork ? (
                    <div className="space-y-3" role="status">
                      <p>
                        {t('activeRequest', {
                          reference: `HTH-${activeWork.reference}`,
                        })}
                      </p>
                      <Button
                        className="min-h-11"
                        onClick={() => setView('overview')}
                      >
                        {t('views.overview')}
                      </Button>
                    </div>
                  ) : (
                    <fieldset disabled={busy} className="space-y-3">
                      {kind === 'workshop' && (
                        <>
                          <Label htmlFor="work-quotation">
                            {t('acceptedQuotation')}
                          </Label>
                          <select
                            id="work-quotation"
                            className="bg-background w-full rounded border p-2"
                            value={quotation}
                            onChange={(e) => setQuotation(e.target.value)}
                          >
                            <option value="">{t('selectQuotation')}</option>
                            {data.quotations.map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.reference} · rev {q.revision}
                              </option>
                            ))}
                          </select>
                          {!data.quotations.length && (
                            <p className="text-muted-foreground text-sm">
                              {t('noAcceptedQuotation')}
                            </p>
                          )}
                        </>
                      )}
                      <Label htmlFor="work-location">{t('location')}</Label>
                      <Input
                        id="work-location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        maxLength={1000}
                      />
                      <Label htmlFor="work-details">{t('details')}</Label>
                      <textarea
                        id="work-details"
                        className="bg-background min-h-24 w-full rounded border p-2"
                        value={details}
                        onChange={(e) => setDetails(e.target.value)}
                        maxLength={10000}
                        aria-describedby="work-details-hint"
                      />
                      <p
                        id="work-details-hint"
                        className="text-muted-foreground text-xs"
                      >
                        {t('detailsHint')}
                      </p>
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-sm">
                          {t('optionalDetails')}
                        </summary>
                        <Label htmlFor="work-responsible">
                          {t('responsible')}
                        </Label>
                        <Input
                          id="work-responsible"
                          value={responsible}
                          onChange={(e) => setResponsible(e.target.value)}
                          maxLength={200}
                        />
                      </details>
                      <Label htmlFor="work-due">{t('requestedDate')}</Label>
                      <BusinessTimeNote />
                      <Input
                        id="work-due"
                        type="datetime-local"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                        aria-invalid={invalidDue}
                        aria-describedby={
                          invalidDue ? 'work-prepare-blocker' : undefined
                        }
                      />
                      {prepareBlocker && (
                        <p
                          id="work-prepare-blocker"
                          className="text-muted-foreground text-sm"
                          role="status"
                        >
                          {prepareBlocker}
                        </p>
                      )}
                      <Button
                        className="min-h-11 w-full"
                        onClick={create}
                        disabled={busy || Boolean(prepareBlocker)}
                        aria-describedby={
                          prepareBlocker ? 'work-prepare-blocker' : undefined
                        }
                      >
                        {t('prepare')}
                      </Button>
                    </fieldset>
                  )}
                </section>
              )}
              {view === 'overview' && !visibleWork.length && (
                <p className="text-muted-foreground text-sm">
                  {t(selectedWorkId ? 'workUnavailable' : 'noWork')}
                </p>
              )}
              {view !== 'prepare' &&
                visibleWork.map((work) => (
                  <WorkRecord
                    key={`${work.id}-${work.revision}-${view}`}
                    work={work}
                    initialAction={view === 'report' ? 'report' : undefined}
                    message={groupMessage(
                      work,
                      data.deal.contact ?? {},
                      locale
                    )}
                    dealId={dealId}
                    onSaved={async () => {
                      await load();
                      announce();
                    }}
                  />
                ))}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
function WorkRecord({
  work,
  message,
  dealId,
  onSaved,
  initialAction,
}: {
  work: Work;
  message: string;
  dealId: string;
  onSaved: () => Promise<void>;
  initialAction?: WorkAction;
}) {
  const t = useTranslations('Jobs');
  const locale = useLocale();
  const available = actions.filter(
    (action) => nextStatus(work, action) !== null
  );
  const [action, setAction] = useState<WorkAction>(
    initialAction && available.includes(initialAction)
      ? initialAction
      : (available[0] ?? 'update')
  );
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const evidenceMissing =
    needsEvidence(action) && note.trim().length < 10 && files.length === 0;
  async function share() {
    if (!navigator.share) {
      toast.error(t('shareUnavailable'));
      return;
    }
    setSharing(true);
    try {
      await navigator.share({ text: message });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        toast.error(t('shareUnavailable'));
    } finally {
      setSharing(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('id', work.id);
      form.set('revision', String(work.revision));
      form.set('action', action);
      form.set('note', note);
      files.forEach((file) => form.append('files', file));
      const res = await fetch(`/api/jobs/${dealId}`, {
        method: 'PATCH',
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await onSaved();
      toast.success(t('saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-job-card space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold">
          HTH-{work.reference} · {t(`kinds.${work.kind}`)}
        </h3>
        <span className={`crm-job-status ${statusClasses(work.status)}`}>
          {t(`statuses.${work.status}`)}
        </span>
      </div>
      {work.quotation_snapshot && (
        <p className="text-sm">
          {t('acceptedQuotation')}: {work.quotation_snapshot.reference} · rev{' '}
          {work.quotation_snapshot.revision}
        </p>
      )}
      {work.due_at && (
        <p className="text-sm">
          {t('requestedDate')}:{' '}
          {new Date(work.due_at).toLocaleString(locale, {
            timeZone: BUSINESS_TIME_ZONE,
          })}
        </p>
      )}
      {work.status === 'draft' && (
        <p className="text-muted-foreground text-sm">{t('shareHint')}</p>
      )}
      <details open={work.status === 'draft'}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm">
          {t('groupMessage')}
        </summary>
        <textarea
          aria-label={t('groupMessage')}
          className="bg-muted mt-2 min-h-48 w-full rounded border p-2 text-sm"
          value={message}
          readOnly
        />
        <Button
          variant="outline"
          className="mt-2 min-h-11"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message);
              toast.success(t('copied'));
            } catch {
              toast.error(t('copyManually'));
            }
          }}
        >
          <Clipboard className="me-2 h-4 w-4" />
          {t('copy')}
        </Button>
        <Button
          variant="outline"
          className="ms-2 mt-2 min-h-11"
          disabled={sharing}
          onClick={share}
        >
          <Share2 aria-hidden />
          {t('share')}
        </Button>
        <p className="text-muted-foreground mt-2 text-xs">{t('copyHint')}</p>
      </details>
      {available.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              {t('addUpdate')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map((value) => (
                <Button
                  key={value}
                  variant={action === value ? 'default' : 'outline'}
                  className="h-auto min-h-11 justify-start px-3 py-2 text-start whitespace-normal"
                  aria-pressed={action === value}
                  onClick={() => setAction(value)}
                >
                  {t(`actions.${value}`)}
                </Button>
              ))}
            </div>
            <Label htmlFor={`note-${work.id}`}>{t('report')}</Label>
            <textarea
              id={`note-${work.id}`}
              aria-describedby={`evidence-${work.id}`}
              placeholder={t('reportHint')}
              maxLength={10000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bg-background min-h-24 w-full rounded border p-2"
            />
            <p
              id={`evidence-${work.id}`}
              className="text-muted-foreground text-xs"
            >
              {needsEvidence(action)
                ? t('evidenceRequired')
                : t('noteOptional')}
            </p>
            <Label htmlFor={`files-${work.id}`}>{t('attachments')}</Label>
            <Input
              id={`files-${work.id}`}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,audio/*"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <p className="text-muted-foreground text-xs">{t('uploadHint')}</p>
            <Button
              className="min-h-11 w-full"
              disabled={busy || sharing || evidenceMissing}
              onClick={save}
            >
              {t('saveUpdate')}
            </Button>
          </fieldset>
        </div>
      )}
      <div className="space-y-3">
        {[...work.events]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((event) => (
            <article className="border-t pt-2 text-sm" key={event.id}>
              <p className="text-muted-foreground">
                {t(`actions.${event.action}`)} ·{' '}
                {new Date(event.created_at).toLocaleString(locale, {
                  timeZone: BUSINESS_TIME_ZONE,
                })}
              </p>
              <p className="whitespace-pre-wrap">{event.note}</p>
              {event.attachments.map((file) =>
                file.url ? (
                  <a
                    className="me-3 underline"
                    key={file.path}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {file.name}
                  </a>
                ) : (
                  <span key={file.path}>
                    {file.name} · {t('reload')}
                  </span>
                )
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
type QueueWork = Pick<
  GroupWork,
  'id' | 'deal_id' | 'reference' | 'kind' | 'status' | 'due_at' | 'responsible'
> & { deal: { title: string } | null };
export function WaitingWorkQueue() {
  const t = useTranslations('Jobs');
  const locale = useLocale();
  const canEdit = useCan('send-messages');
  const [rows, setRows] = useState<QueueWork[]>([]);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [dealId, setDealId] = useState<string | null>(null);
  const queueDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      if (window.location.hash === '#waiting-work' && queueDetails.current)
        queueDetails.current.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [canEdit]);
  useEffect(() => {
    if (!canEdit) return;
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch('/api/jobs', { signal: controller.signal });
        if (!res.ok) throw new Error('load');
        const data = await res.json();
        if (!controller.signal.aborted) {
          setRows(data.work);
          setMore(data.hasMore);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    const refresh = () => void load();
    window.addEventListener('group-work-updated', refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('group-work-updated', refresh);
    };
  }, [canEdit]);
  if (!canEdit) return null;
  return (
    <section
      id="waiting-work"
      className="bg-card mb-4 scroll-mt-4 rounded-lg border p-4"
    >
      <details ref={queueDetails}>
        <summary className="cursor-pointer font-semibold">
          {t('queue')} ({rows.length}
          {more ? '+' : ''})
        </summary>
        <p className="text-muted-foreground my-2 text-sm">{t('queueHint')}</p>
        {error ? (
          <p role="alert">{t('error')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('emptyQueue')}</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <button
                key={row.id}
                className="hover:bg-muted flex w-full flex-wrap items-center justify-between gap-2 rounded border p-3 text-start text-sm"
                onClick={() => setDealId(row.deal_id)}
              >
                <span>
                  HTH-{row.reference} · {row.deal?.title} ·{' '}
                  {t(`kinds.${row.kind}`)}
                </span>
                <span>
                  <span className={statusClasses(row.status)}>
                    {t(`statuses.${row.status}`)}
                  </span>{' '}
                  {row.due_at && (
                    <span
                      className={
                        Date.parse(row.due_at) < Date.now()
                          ? 'text-destructive'
                          : ''
                      }
                    >
                      ·{' '}
                      {Date.parse(row.due_at) < Date.now() ? t('overdue') : ''}{' '}
                      {new Date(row.due_at).toLocaleString(locale, {
                        timeZone: BUSINESS_TIME_ZONE,
                      })}
                    </span>
                  )}{' '}
                  {row.responsible && `· ${row.responsible}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </details>
      {dealId && (
        <GroupWorkDialog
          key={dealId}
          dealId={dealId}
          onClose={() => setDealId(null)}
        />
      )}
    </section>
  );
}
