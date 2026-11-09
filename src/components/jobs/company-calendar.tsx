'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WorkspaceSelect } from '@/components/quotations/workspace-select';
import { PageIdentity } from '@/components/workspace/page-identity';
import { GroupWorkDialog } from './group-work';
import { AppointmentFields } from './appointment-fields';
import { businessDayKey, formatBusinessDate } from '@/lib/business-time';
import {
  dayInstant,
  shiftDay,
  type Appointment,
  type BookingSelection,
  type JobPerson,
} from '@/lib/jobs/appointments';
import { toast } from 'sonner';

type Pending = {
  id: string;
  deal_id: string;
  reference: number;
  kind: 'measurement' | 'workshop';
  responsible_profile_id: string | null;
  due_at: string | null;
  deal: { title: string } | null;
};
type Data = {
  appointments: Appointment[];
  unscheduled: Pending[];
  people: JobPerson[];
  defaultResponsibleId: string | null;
  hasMore: boolean;
};
type Edit = {
  handoffId: string;
  dealId: string;
  label: string;
  responsible: string;
  appointment?: Appointment;
};
export function CompanyCalendar() {
  const t = useTranslations('Jobs'),
    locale = useLocale();
  const [day, setDay] = useState(() => businessDayKey(new Date()));
  const [view, setView] = useState<'week' | 'day'>('week');
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState(false),
    [settled, setSettled] = useState('');
  const [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [request, setRequest] = useState<{ dealId: string; id: string } | null>(
    null
  );
  const monday = shiftDay(
    day,
    -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7)
  );
  const startDay = view === 'day' ? day : monday;
  const days = Array.from({ length: view === 'day' ? 1 : 7 }, (_, index) =>
    shiftDay(startDay, index)
  );
  const endDay = shiftDay(startDay, days.length);
  const requestKey = `${startDay}/${endDay}/${revision}`;
  const loading = settled !== requestKey;
  const failed = !loading && loadError;
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/jobs/appointments?${new URLSearchParams({ from: dayInstant(startDay)!, to: dayInstant(endDay)! })}`,
      { signal: controller.signal, cache: 'no-store' }
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('calendar');
        return res.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setData(body);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettled(requestKey);
      });
    return () => controller.abort();
  }, [startDay, endDay, requestKey]);
  useEffect(() => {
    window.addEventListener('group-work-updated', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('group-work-updated', refresh);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);
  function schedule(work: Pending) {
    setEdit({
      handoffId: work.id,
      dealId: work.deal_id,
      label: `HTH-${work.reference} · ${work.deal?.title ?? ''}`,
      responsible: data?.people.some(
        (person) => person.id === work.responsible_profile_id
      )
        ? work.responsible_profile_id!
        : (data?.defaultResponsibleId ?? ''),
    });
  }
  return (
    <div className="crm-page space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageIdentity icon={CalendarDays}>
          <h1>{t('calendarTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('calendarCapacity')}
          </p>
        </PageIdentity>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          {t('reload')}
        </Button>
      </header>
      <section
        className="border-border bg-card space-y-4 rounded-xl border p-3 sm:p-4"
        aria-label={t('calendarTitle')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t('previousPeriod')}
              onClick={() => setDay(shiftDay(day, view === 'week' ? -7 : -1))}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setDay(businessDayKey(new Date()))}
            >
              {t('today')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('nextPeriod')}
              onClick={() => setDay(shiftDay(day, view === 'week' ? 7 : 1))}
            >
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
          <p className="text-sm font-medium" aria-live="polite">
            {formatBusinessDate(dayInstant(startDay)!, locale, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            {view === 'week'
              ? ` – ${formatBusinessDate(dayInstant(shiftDay(endDay, -1))!, locale, { day: 'numeric', month: 'short' })}`
              : ''}
          </p>
          <div
            className="flex gap-1"
            role="group"
            aria-label={t('calendarView')}
          >
            {(['day', 'week'] as const).map((value) => (
              <Button
                key={value}
                variant={view === value ? 'default' : 'outline'}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {t(value)}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-muted-foreground text-xs">{t('reservationHint')}</p>
        {failed ? (
          <p role="alert" className="text-destructive py-8 text-sm">
            {t('calendarFailed')}
          </p>
        ) : loading ? (
          <p role="status" className="text-muted-foreground py-8 text-sm">
            {t('checkingCalendar')}
          </p>
        ) : (
          <div
            className={`grid gap-3 ${view === 'week' ? 'md:grid-cols-2 xl:grid-cols-7' : ''}`}
          >
            {days.map((date) => {
              const from = dayInstant(date)!,
                to = dayInstant(shiftDay(date, 1))!;
              const appointments = (data?.appointments ?? []).filter(
                (a) =>
                  Date.parse(a.starts_at) < Date.parse(to) &&
                  Date.parse(a.ends_at) > Date.parse(from)
              );
              return (
                <section
                  key={date}
                  className="border-border min-w-0 rounded-lg border p-2"
                  aria-label={date}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDay(date);
                      setView('day');
                    }}
                    className="hover:bg-muted mb-2 min-h-11 w-full rounded-md px-2 text-start text-sm font-medium"
                    aria-current={
                      date === businessDayKey(new Date()) ? 'date' : undefined
                    }
                  >
                    {formatBusinessDate(from, locale, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </button>
                  {appointments.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-6 text-xs">
                      {t('noAppointments')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {appointments.map((a) => (
                        <article
                          key={a.id}
                          className={`border-border space-y-2 rounded-lg border p-3 text-sm ${a.status === 'completed' ? 'bg-muted/40' : a.kind === 'visit' ? 'bg-success/5' : 'bg-info/5'}`}
                        >
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <Clock3 className="size-3.5 shrink-0" aria-hidden />
                            {formatBusinessDate(a.starts_at, locale, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            –{' '}
                            {formatBusinessDate(a.ends_at, locale, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                          <p className="font-medium">
                            {a.kind
                              ? t(
                                  a.kind === 'visit'
                                    ? 'visitAppointment'
                                    : 'installationAppointment'
                                )
                              : t('busy')}
                          </p>
                          {a.work && (
                            <>
                              <p className="text-xs break-words">
                                HTH-{a.work.reference} · {a.work.deal?.title}
                              </p>
                              <p className="text-muted-foreground flex gap-1 text-xs">
                                <UserRound
                                  className="size-3.5 shrink-0"
                                  aria-hidden
                                />
                                {a.responsible_name}
                              </p>
                              {a.status === 'reserved' &&
                                !data?.people.some(
                                  (person) =>
                                    person.id === a.responsible_profile_id
                                ) && (
                                  <p className="text-warning text-xs">
                                    {t('memberUnavailable')}
                                  </p>
                                )}
                              <p className="text-muted-foreground flex gap-1 text-xs break-words">
                                <MapPin
                                  className="size-3.5 shrink-0"
                                  aria-hidden
                                />
                                <span className="line-clamp-2">
                                  {a.work.location}
                                </span>
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {t(
                                  a.status === 'completed'
                                    ? 'completedAppointment'
                                    : 'reservedAppointment'
                                )}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {t(`statuses.${a.work.status}`)}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {a.status === 'reserved' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setEdit({
                                        handoffId: a.handoff_id!,
                                        dealId: a.deal_id!,
                                        label: `HTH-${a.work!.reference}`,
                                        responsible: data?.people.some(
                                          (person) =>
                                            person.id ===
                                            a.responsible_profile_id
                                        )
                                          ? a.responsible_profile_id!
                                          : (data?.defaultResponsibleId ?? ''),
                                        appointment: a,
                                      })
                                    }
                                  >
                                    {t('reschedule')}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setRequest({
                                      dealId: a.deal_id!,
                                      id: a.handoff_id!,
                                    })
                                  }
                                >
                                  {t('openRequest')}
                                </Button>
                              </div>
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
      <section className="border-border bg-card space-y-3 rounded-xl border p-4">
        <h2 className="text-base font-semibold">{t('unscheduledTitle')}</h2>
        <p className="text-muted-foreground text-sm">{t('unscheduledHint')}</p>
        {!loading && !failed && !data?.unscheduled.length && (
          <p className="text-muted-foreground text-sm">{t('noUnscheduled')}</p>
        )}
        {!failed &&
          data?.unscheduled.map((work) => (
            <div
              key={work.id}
              className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">
                  HTH-{work.reference} · {work.deal?.title}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t(
                    work.kind === 'measurement'
                      ? 'visitAppointment'
                      : 'installationAppointment'
                  )}
                </p>
              </div>
              <Button variant="outline" onClick={() => schedule(work)}>
                <Plus className="size-4" aria-hidden />
                {t('schedule')}
              </Button>
            </div>
          ))}
        {data?.hasMore && (
          <p role="status" className="text-muted-foreground text-xs">
            {t('calendarMore')}
          </p>
        )}
      </section>
      {edit && data && (
        <BookingEditor
          key={`${edit.handoffId}/${edit.appointment?.revision ?? 'new'}`}
          edit={edit}
          people={data.people}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            window.dispatchEvent(new Event('group-work-updated'));
          }}
        />
      )}
      {request && (
        <GroupWorkDialog
          dealId={request.dealId}
          initialWorkId={request.id}
          onClose={() => setRequest(null)}
        />
      )}
    </div>
  );
}

function BookingEditor({
  edit,
  people,
  onClose,
  onSaved,
}: {
  edit: Edit;
  people: JobPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Jobs');
  const [person, setPerson] = useState(edit.responsible),
    [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<BookingSelection>({
    starts_at: '',
    ends_at: '',
    available: false,
  });
  async function save() {
    if (!person || !slot.available) return;
    setBusy(true);
    try {
      const res = await fetch('/api/jobs/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: edit.dealId,
          handoffId: edit.handoffId,
          revision: edit.appointment?.revision,
          responsible_profile_id: person,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        window.dispatchEvent(new Event('group-work-updated'));
        throw new Error(
          body.code === 'slot_unavailable'
            ? t('slotBusy')
            : body.code === 'stale_booking'
              ? t('staleBooking')
              : t('error')
        );
      }
      toast.success(t('saved'));
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(edit.appointment ? 'reschedule' : 'schedule')} · {edit.label}
          </DialogTitle>
        </DialogHeader>
        <Label htmlFor="calendar-member">{t('responsibleMember')}</Label>
        <WorkspaceSelect
          id="calendar-member"
          aria-label={t('responsibleMember')}
          value={person}
          onValueChange={setPerson}
          disabled={busy}
          className="w-full"
        >
          <option value="">{t('choosePerson')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || t('teamMember')}
            </option>
          ))}
        </WorkspaceSelect>
        <AppointmentFields
          initial={edit.appointment}
          onChange={setSlot}
          disabled={busy}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={busy || !person || !slot.available}>
            {busy ? t('saving') : t('reserveTime')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
