import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { mobileApi } from './mobile-api';
import { useForeground } from './use-foreground';
import { Avatar, type Conversation } from './workspace-ui';
type Details = {
  contact: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    company: string | null;
    avatar_url: string | null;
  };
  tags: { id: string; name: string }[];
  notes: { id: string; note_text: string; created_at: string }[];
  notesLimit: number;
};
export function ContactDetails({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const foreground = useForeground();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="contact-details"
      aria-labelledby="contact-details-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="contact-details-bar">
        <h2 id="contact-details-title">Contact details</h2>
        <div>
          <button
            className="icon-button"
            aria-label="Refresh contact details"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshCw size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Close contact details"
            onClick={onClose}
          >
            <X size={23} />
          </button>
        </div>
      </header>
      {foreground && (
        <ContactDetailsContent
          key={attempt}
          conversation={conversation}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
    </dialog>
  );
}

function ContactDetailsContent({
  conversation,
  onRetry,
}: {
  conversation: Conversation;
  onRetry: () => void;
}) {
  const [data, setData] = useState<Details | null>(null),
    [error, setError] = useState(''),
    [copied, setCopied] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void mobileApi<Details>(
      `/api/mobile/conversations/${conversation.id}/contact`,
      { signal: controller.signal }
    )
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : 'Contact details could not be loaded.'
          );
      });
    return () => controller.abort();
  }, [conversation.id]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError('Copy failed. Select and copy the text instead.');
    }
  }
  return (
    <div className="contact-details-scroll">
      {!data && !error && (
        <p role="status" className="contact-feedback">
          Loading contact…
        </p>
      )}
      {error && (
        <div className="contact-feedback">
          <p role="alert">{error}</p>
          <button className="text" onClick={() => onRetry()}>
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          <section className="contact-summary">
            <Avatar conversation={{ ...conversation, contact: data.contact }} />
            <h3 dir="auto">{data.contact.name || data.contact.phone}</h3>
            <p>Saved in your CRM</p>
          </section>
          <section className="contact-section" aria-label="Contact information">
            <dl>
              <div>
                <dt>Phone</dt>
                <dd>
                  <span dir="ltr">{data.contact.phone}</span>
                  <button
                    className="icon-button"
                    aria-label="Copy phone"
                    onClick={() => void copy(data.contact.phone, 'phone')}
                  >
                    {copied === 'phone' ? (
                      <Check size={18} />
                    ) : (
                      <Copy size={18} />
                    )}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd dir="auto">{data.contact.company || 'Not added'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  <span dir="auto">{data.contact.email || 'Not added'}</span>
                  {data.contact.email && (
                    <button
                      className="icon-button"
                      aria-label="Copy email"
                      onClick={() => void copy(data.contact.email!, 'email')}
                    >
                      {copied === 'email' ? (
                        <Check size={18} />
                      ) : (
                        <Copy size={18} />
                      )}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section className="contact-section">
            <h3>Tags</h3>
            {data.tags.length ? (
              <ul className="contact-tags">
                {data.tags.map((t) => (
                  <li key={t.id} dir="auto">
                    {t.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No tags added</p>
            )}
          </section>
          <section className="contact-section">
            <h3>Notes</h3>
            {data.notes.length ? (
              <ol className="contact-notes">
                {data.notes.map((n) => (
                  <li key={n.id}>
                    <p dir="auto">{n.note_text}</p>
                    <time dateTime={n.created_at}>
                      {new Intl.DateTimeFormat('en', {
                        timeZone: 'Asia/Qatar',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(n.created_at))}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No notes yet</p>
            )}
            {data.notes.length === data.notesLimit && (
              <p className="muted">
                Showing the latest {data.notesLimit} notes.
              </p>
            )}
          </section>
          <p className="contact-details-hint">
            Manage contact information, tags and notes in the CRM.
          </p>
        </>
      )}
    </div>
  );
}
