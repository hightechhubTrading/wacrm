import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Clock3, RefreshCw, X } from 'lucide-react';
import { mobileApi, MobileApiError } from './mobile-api';
import { useForeground } from './use-foreground';
import { businessDayBoundary } from '../../src/lib/business-time';
import type { Conversation } from './workspace-ui';
type Task = {
  id: string;
  kind: string;
  status: string;
  owner_id: string | null;
  due_at: string;
  updated_at: string;
  conversation_id: string;
  conversation: { contact: { name: string | null; phone: string } | null };
};
type Tasks = {
  tasks: Task[];
  total: number;
  nextOffset: number | null;
  timeZone: string;
  canEdit: boolean;
};
const labels: Record<string, string> = {
  handoff: 'Customer follow-up',
  quotation: 'Quotation follow-up',
  inspection: 'Site inspection',
  repair: 'Repair follow-up',
  location: 'Customer location',
  comparison: 'Product comparison',
  document_review: 'Document review',
};
export function TodayView({
  revision,
  onOpen,
  initialScroll,
  onScrollPosition,
}: {
  revision: number;
  onOpen: (conversation: Conversation) => void;
  initialScroll: number;
  onScrollPosition: (position: number) => void;
}) {
  const foreground = useForeground();
  const [snapshot, setSnapshot] = useState<Tasks | null>(null),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [completion, setCompletion] = useState<Task | null>(null),
    [evidence, setEvidence] = useState('');
  const evidenceTask = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    lock = useRef(false),
    alive = useRef(true),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!foreground) return;
    const controller = new AbortController();
    const current = ++generation.current;
    void mobileApi<Tasks>('/api/mobile/today', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted && current === generation.current) {
          setSnapshot(data);
          setError('');
          requestAnimationFrame(() => {
            if (scroll.current) scroll.current.scrollTop = initialScroll;
          });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === generation.current) {
          setSnapshot(null);
          setError(e.message);
        }
      });
    return () => controller.abort();
  }, [foreground, revision, refresh, initialScroll]);
  async function more() {
    if (lock.current || !snapshot?.nextOffset) return;
    lock.current = true;
    setBusy(true);
    const current = generation.current;
    try {
      const data = await mobileApi<Tasks>(
        '/api/mobile/today?offset=' + snapshot.nextOffset
      );
      if (alive.current && current === generation.current)
        setSnapshot((previous) =>
          previous
            ? {
                ...data,
                tasks: [
                  ...previous.tasks,
                  ...data.tasks.filter(
                    (t) => !previous.tasks.some((p) => p.id === t.id)
                  ),
                ],
              }
            : data
        );
    } catch {
      if (alive.current)
        setError('More tasks could not be loaded. Please retry.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save(task: Task, status: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    try {
      await mobileApi('/api/mobile/today', {
        method: 'POST',
        body: {
          id: task.id,
          conversation_id: task.conversation_id,
          expected_updated_at: task.updated_at,
          status,
          ...(status === 'completed' ? { completion_evidence: evidence } : {}),
          ...(status === 'deferred'
            ? {
                due_at: new Date(
                  businessDayBoundary(new Date(), 1).getTime() + 9 * 3600000
                ).toISOString(),
              }
            : {}),
        },
      });
      if (alive.current) {
        setCompletion(null);
        setEvidence('');
        evidenceTask.current = null;
        setNotice(
          status === 'completed'
            ? 'Follow-up completed.'
            : status === 'deferred'
              ? 'Moved to tomorrow at 09:00 Qatar time.'
              : 'Follow-up assigned to you.'
        );
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (alive.current) {
        if (e instanceof MobileApiError && e.status === 409) {
          setCompletion(null);
          setRefresh((n) => n + 1);
          setNotice(
            'This task changed. Review the updated follow-up before trying again.'
          );
        } else
          setNotice(
            e instanceof Error
              ? e.message
              : 'Task could not be saved. Refresh and retry.'
          );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const start = businessDayBoundary(new Date(), 0).getTime();
  const tasks = foreground ? snapshot : null;
  return (
    <section className="today-view" aria-label="Today">
      <div className="today-heading">
        <div>
          <p>
            {new Intl.DateTimeFormat('en', {
              timeZone: 'Asia/Qatar',
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }).format(new Date())}
          </p>
          <h2>Your follow-ups</h2>
          <small>Due today and overdue · Qatar time</small>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh Today"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={20} />
        </button>
      </div>
      {notice && (
        <p className="today-feedback" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="today-feedback">
          <p role="alert">{error}</p>
          <button className="text" onClick={() => setRefresh((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {!tasks && !error && (
        <p className="today-feedback" role="status">
          Loading follow-ups…
        </p>
      )}
      <div
        className="today-scroll"
        ref={scroll}
        onScroll={(e) => onScrollPosition(e.currentTarget.scrollTop)}
      >
        {tasks && (
          <>
            <p className="task-count">
              {tasks.total} {tasks.total === 1 ? 'follow-up' : 'follow-ups'} to
              review
            </p>
            {!tasks.tasks.length && (
              <div className="empty-state">
                <Check size={30} />
                <h3>You’re up to date</h3>
                <p>No open follow-ups are due today.</p>
              </div>
            )}
            {tasks.tasks.map((task) => (
              <article className="today-task" key={task.id}>
                <button
                  className="task-contact"
                  onClick={() =>
                    onOpen({
                      id: task.conversation_id,
                      contact: task.conversation.contact,
                      last_message_at: null,
                      last_message_text: null,
                    })
                  }
                >
                  <div>
                    <span className="task-kind">
                      {labels[task.kind] ?? 'Follow-up'}
                    </span>
                    <h3 dir="auto">
                      {task.conversation.contact?.name ||
                        task.conversation.contact?.phone ||
                        'Customer conversation'}
                    </h3>
                  </div>
                  <ChevronRight size={20} />
                </button>
                <p
                  className={
                    Date.parse(task.due_at) < start
                      ? 'task-due overdue'
                      : 'task-due'
                  }
                >
                  <Clock3 size={14} />
                  {Date.parse(task.due_at) < start ? 'Overdue · ' : ''}
                  {new Intl.DateTimeFormat('en', {
                    timeZone: 'Asia/Qatar',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }).format(new Date(task.due_at))}
                </p>
                {tasks.canEdit && (
                  <div className="task-actions">
                    {task.owner_id === null && (
                      <button
                        className="text"
                        disabled={busy}
                        onClick={() => void save(task, 'acknowledged')}
                      >
                        Take task
                      </button>
                    )}
                    <button
                      className="text"
                      disabled={busy}
                      onClick={() => void save(task, 'deferred')}
                    >
                      Tomorrow
                    </button>
                    <button
                      className="text"
                      disabled={busy}
                      onClick={() => {
                        if (evidenceTask.current !== task.id) setEvidence('');
                        evidenceTask.current = task.id;
                        setNotice('');
                        setCompletion(task);
                      }}
                    >
                      Complete
                    </button>
                  </div>
                )}
              </article>
            ))}
            {tasks.nextOffset !== null && (
              <button
                className="today-more"
                disabled={busy}
                onClick={() => void more()}
              >
                Show more follow-ups
              </button>
            )}
          </>
        )}
      </div>
      {completion && (
        <CompletionDialog
          busy={busy}
          error={notice}
          evidence={evidence}
          onEvidence={setEvidence}
          task={completion}
          onClose={() => {
            if (!busy) setCompletion(null);
          }}
          onSave={() => void save(completion, 'completed')}
        />
      )}
    </section>
  );
}
function CompletionDialog({
  task,
  busy,
  error,
  evidence,
  onEvidence,
  onClose,
  onSave,
}: {
  task: Task;
  busy: boolean;
  error: string;
  evidence: string;
  onEvidence: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      className="task-completion"
      ref={ref}
      aria-labelledby="completion-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="completion-title">Complete follow-up</h2>
        <button
          className="icon-button"
          aria-label="Close completion"
          disabled={busy}
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      <p dir="auto">
        {task.conversation.contact?.name || task.conversation.contact?.phone}
      </p>
      <label htmlFor="completion-evidence">What was completed?</label>
      <textarea
        id="completion-evidence"
        rows={4}
        maxLength={2000}
        value={evidence}
        dir="auto"
        onChange={(e) => onEvidence(e.target.value)}
        placeholder="Add the outcome for your team"
        disabled={busy}
      />
      {error && <p role="alert">{error}</p>}
      <p className="muted">At least 10 characters. This is saved in the CRM.</p>
      <button
        className="primary"
        disabled={busy || evidence.trim().length < 10}
        onClick={onSave}
      >
        {busy ? 'Saving…' : 'Save completion'}
      </button>
    </dialog>
  );
}
