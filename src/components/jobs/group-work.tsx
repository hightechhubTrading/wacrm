'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Clipboard, MessagesSquare } from 'lucide-react';
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
}: {
  dealId: string;
  onClose: () => void;
  initialKind?: WorkKind;
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
          due_at: due ? new Date(due).toISOString() : null,
          quotation_id: quotation || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await load();
      announce();
      setDetails('');
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
              <section className="crm-job-card space-y-3 rounded-lg border p-3">
                <h3 className="font-semibold">{t('newRequest')}</h3>
                <Label htmlFor="work-kind">{t('kind')}</Label>
                <select
                  id="work-kind"
                  className="bg-background w-full rounded border p-2"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as WorkKind)}
                >
                  <option value="measurement">{t('kinds.measurement')}</option>
                  <option value="workshop">{t('kinds.workshop')}</option>
                </select>
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
                />
                <Label htmlFor="work-responsible">{t('responsible')}</Label>
                <Input
                  id="work-responsible"
                  value={responsible}
                  onChange={(e) => setResponsible(e.target.value)}
                  maxLength={200}
                />
                <Label htmlFor="work-due">{t('requestedDate')}</Label>
                <Input
                  id="work-due"
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
                <Button
                  onClick={create}
                  disabled={
                    busy ||
                    !location.trim() ||
                    details.trim().length < 10 ||
                    (kind === 'workshop' && !quotation)
                  }
                >
                  {t('prepare')}
                </Button>
              </section>
              {data.work.map((work) => (
                <WorkRecord
                  key={`${work.id}-${work.revision}`}
                  work={work}
                  message={groupMessage(work, data.deal.contact ?? {}, locale)}
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
}: {
  work: Work;
  message: string;
  dealId: string;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('Jobs');
  const locale = useLocale();
  const available = actions.filter(
    (action) => nextStatus(work, action) !== null
  );
  const [action, setAction] = useState<WorkAction>(available[0] ?? 'update');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
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
        <span className="crm-job-status">{t(`statuses.${work.status}`)}</span>
      </div>
      {work.quotation_snapshot && (
        <p className="text-sm">
          {t('acceptedQuotation')}: {work.quotation_snapshot.reference} · rev{' '}
          {work.quotation_snapshot.revision}
        </p>
      )}
      {work.due_at && (
        <p className="text-sm">
          {t('requestedDate')}: {new Date(work.due_at).toLocaleString(locale)}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">
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
          className="mt-2"
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
        <p className="text-muted-foreground mt-2 text-xs">{t('copyHint')}</p>
      </details>
      {available.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <Label htmlFor={`action-${work.id}`}>{t('addUpdate')}</Label>
          <select
            id={`action-${work.id}`}
            className="bg-background w-full rounded border p-2"
            value={action}
            onChange={(e) => setAction(e.target.value as WorkAction)}
          >
            {available.map((a) => (
              <option value={a} key={a}>
                {t(`actions.${a}`)}
              </option>
            ))}
          </select>
          <textarea
            aria-label={t('report')}
            placeholder={t('reportHint')}
            maxLength={10000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="bg-background min-h-24 w-full rounded border p-2"
          />
          <Label htmlFor={`files-${work.id}`}>{t('attachments')}</Label>
          <Input
            id={`files-${work.id}`}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,audio/*"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <p className="text-muted-foreground text-xs">{t('uploadHint')}</p>
          <Button disabled={busy} onClick={save}>
            {t('saveUpdate')}
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {[...work.events]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((event) => (
            <article className="border-t pt-2 text-sm" key={event.id}>
              <p className="text-muted-foreground">
                {t(`actions.${event.action}`)} ·{' '}
                {new Date(event.created_at).toLocaleString(locale)}
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
    <section className="bg-card mb-4 rounded-lg border p-4">
      <details>
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
                  {t(`statuses.${row.status}`)}{' '}
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
                      {new Date(row.due_at).toLocaleString(locale)}
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
