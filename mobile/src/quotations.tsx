import type { Conversation } from './workspace-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  Search,
  Share2,
  X,
  Send,
  MessageSquare,
} from 'lucide-react';
import { mobileApi, MobileApiError } from './mobile-api';
import { useForeground } from './use-foreground';
import { PdfPreview } from './attachment-viewer';
import { quotationPdf } from './quotation-pdf';
import type {
  MobileQuotation as Quote,
  MobileQuotationDetail as Detail,
  MobileQuotationList,
  MobileQuotationSummary,
} from '../../src/lib/quotations/mobile-types';
const files = registerPlugin<{
  share(options: { data: string; filename: string }): Promise<void>;
}>('AttachmentFiles');
function amount(value: number | undefined | null, currency: string | null) {
  if (value == null) return '—';
  return `${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))}${currency ? ' ' + currency : ' (currency not set)'}`;
}
export function QuotationsView({
  revision,
  onOpen,
}: {
  revision: number;
  onOpen: (conversation: Conversation) => void;
}) {
  const [rows, setRows] = useState<MobileQuotationSummary[] | null>(null),
    [total, setTotal] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [search, setSearch] = useState(''),
    [field, setField] = useState('client_name'),
    [term, setTerm] = useState(''),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true),
    load = useRef(0),
    lock = useRef(false);
  const foreground = useForeground();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!foreground) return;
    const controller = new AbortController();
    const current = ++load.current;
    void mobileApi<MobileQuotationList>(
      `/api/mobile/quotations?field=${field}&search=${encodeURIComponent(term)}`,
      { signal: controller.signal }
    )
      .then((d) => {
        if (!controller.signal.aborted && current === load.current) {
          setRows(d.quotations);
          setTotal(d.total);
          setNext(d.nextOffset);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setRows(null);
          setError(e.message);
        }
      });
    return () => controller.abort();
  }, [foreground, revision, refresh, term, field]);
  async function more() {
    if (next === null || lock.current) return;
    lock.current = true;
    setLoadingMore(true);
    const current = load.current;
    try {
      const d = await mobileApi<MobileQuotationList>(
        `/api/mobile/quotations?offset=${next}&field=${field}&search=${encodeURIComponent(term)}`
      );
      if (alive.current && current === load.current) {
        setRows((old) => [
          ...(old ?? []),
          ...d.quotations.filter((q) => !old?.some((p) => p.id === q.id)),
        ]);
        setTotal(d.total);
        setNext(d.nextOffset);
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : 'More quotations could not be loaded.'
        );
    } finally {
      lock.current = false;
      if (alive.current) setLoadingMore(false);
    }
  }
  const visible = foreground ? rows : null;
  return (
    <section className="quotations-view" aria-label="Quotations">
      <div className="quotes-heading">
        <div>
          <h2>Customer quotations</h2>
          <p>
            {visible
              ? `${total} visible in your CRM`
              : 'Saved quotations from your CRM'}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh quotations"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={20} />
        </button>
      </div>
      <div className="quote-search">
        <Search size={18} />
        <label className="sr" htmlFor="quote-search">
          Search quotations
        </label>
        <input
          id="quote-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            field === 'reference' ? 'Find by reference' : 'Find by client name'
          }
          dir="auto"
        />
        <select
          aria-label="Quotation search field"
          value={field}
          onChange={(e) => setField(e.target.value)}
        >
          <option value="client_name">Client</option>
          <option value="reference">Reference</option>
        </select>
      </div>
      {error && (
        <div className="today-feedback">
          <p role="alert">{error}</p>
          <button className="text" onClick={() => setRefresh((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      <div className="quote-list">
        {!visible && !error && <p role="status">Loading quotations…</p>}
        {visible?.map((q) => (
          <button
            className="quote-row"
            key={q.id}
            onClick={() => setSelected(q.id)}
          >
            <FileText size={24} />
            <span className="quote-row-text">
              <strong>
                {q.reference} · Rev {q.revision}
              </strong>
              <span dir="auto">{q.clientName || 'Client not added'}</span>
              <small>
                {q.status.charAt(0).toUpperCase() + q.status.slice(1)} ·{' '}
                {amount(q.total, q.currency)}
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
        {visible && !visible.length && (
          <div className="empty-state">
            <FileText size={30} />
            <h3>
              {term ? 'No matching quotations' : 'No quotations available'}
            </h3>
            <p>
              {term
                ? 'Try another client name or reference.'
                : 'Quotations you can access in the CRM appear here.'}
            </p>
          </div>
        )}
        {visible && next !== null && (
          <button
            className="today-more"
            disabled={loadingMore}
            onClick={() => void more()}
          >
            Show more quotations
          </button>
        )}
      </div>
      {selected && (
        <QuotationDetails
          key={selected}
          id={selected}
          onOpen={onOpen}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
function QuotationDetails({
  id,
  onOpen,
  onClose,
}: {
  id: string;
  onOpen: (conversation: Conversation) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [caption, setCaption] = useState('');
  const back = useRef<(() => boolean) | null>(null);
  const onBackReady = useCallback((handler: (() => boolean) | null) => {
    back.current = handler;
  }, []);
  const foreground = useForeground();
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="quotation-details"
      aria-label="Quotation details"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!back.current?.()) onClose();
      }}
    >
      {foreground && (
        <QuotationContent
          key={attempt}
          id={id}
          onOpen={onOpen}
          caption={caption}
          onCaption={setCaption}
          onBackReady={onBackReady}
          onClose={onClose}
          onRefresh={() => setAttempt((n) => n + 1)}
        />
      )}
    </dialog>
  );
}
function QuotationContent({
  id,
  onOpen,
  onClose,
  onRefresh,
  caption,
  onCaption,
  onBackReady,
}: {
  onBackReady: (handler: (() => boolean) | null) => void;
  id: string;
  onOpen: (conversation: Conversation) => void;
  caption: string;
  onCaption: (value: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<Blob | null>(null),
    [confirm, setConfirm] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const alive = useRef(true),
    lock = useRef(false),
    download = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void mobileApi<Detail>(`/api/mobile/quotations/${id}`, {
      signal: controller.signal,
    })
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      alive.current = false;
      controller.abort();
      download.current?.abort();
    };
  }, [id]);
  useEffect(() => {
    onBackReady(
      preview
        ? () => {
            setPreview(null);
            return true;
          }
        : null
    );
    return () => onBackReady(null);
  }, [preview, onBackReady]);
  const q = data?.quotation,
    document = data?.document;
  const path = document
    ? `/api/mobile/quotations/${id}/pdf?version=${document.workspaceVersion}&document=${document.id ?? 'legacy'}`
    : '';
  async function pdf(share = false) {
    if (lock.current || !document) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    download.current = controller;
    try {
      const blob = await quotationPdf(path, controller.signal);
      if (!alive.current) return;
      if (!share) {
        setPreview(blob);
        return;
      }
      const filename =
        `${q?.reference ?? 'quotation'}-rev-${q?.revision ?? 0}.pdf`.replace(
          /[\x00-\x1f\/\\]/g,
          '_'
        );
      if (Capacitor.getPlatform() === 'android') {
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(Error('PDF could not be prepared'));
          reader.readAsDataURL(blob);
        });
        if (!alive.current) return;
        await files.share({ data: encoded, filename });
        if (alive.current)
          setNotice('Share sheet opened. Delivery is not confirmed.');
      } else {
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          'PDF download started. It has not been sent to the customer.'
        );
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'PDF could not be loaded.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function send() {
    if (lock.current || !data?.conversationId || !document?.id) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await mobileApi<{
        success?: boolean;
        recordingPending?: boolean;
      }>(`/api/mobile/quotations/${id}/send`, {
        method: 'POST',
        body: {
          confirmed: true,
          documentId: document.id,
          conversationId: data.conversationId,
          caption,
          workspaceVersion: document.workspaceVersion,
        },
      });
      if (alive.current) {
        setConfirm(false);
        if (result.success) {
          setNotice(
            result.recordingPending
              ? 'WhatsApp accepted the PDF; CRM recording is pending. Check the chat.'
              : 'PDF accepted by WhatsApp. Delivery is shown in the chat.'
          );
          setUncertain(true);
        } else {
          setUncertain(true);
          setError(
            'Sending could not be confirmed. Check status before trying again.'
          );
        }
      }
    } catch (e) {
      if (alive.current) {
        setConfirm(false);
        const rejected =
          e instanceof MobileApiError &&
          (e.status === 400 || e.code === 'sendFailed');
        setUncertain(!rejected);
        setError(
          rejected
            ? (e instanceof MobileApiError ? e.reason : undefined) ||
                'The quotation was not sent. Review the message and customer reply window.'
            : 'Sending could not be confirmed. Refresh its status and check the chat before trying again.'
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const sendState = document?.sendState;
  return (
    <>
      <header className="contact-details-bar">
        <div>
          {preview && (
            <button
              className="icon-button"
              aria-label="Back to quotation"
              onClick={() => setPreview(null)}
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <h2>{preview ? 'Quotation PDF' : (q?.reference ?? 'Quotation')}</h2>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label="Refresh quotation details"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Close quotation details"
            disabled={busy}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
      </header>
      {preview ? (
        <PdfPreview blob={preview} />
      ) : (
        <div className="quotation-detail-scroll">
          {error && (
            <div className="today-feedback">
              <p role="alert">{error}</p>
              <button className="text" onClick={onRefresh}>
                Refresh status
              </button>
            </div>
          )}
          {!data && !error && <p role="status">Loading quotation…</p>}
          {data && q && (
            <>
              <section className="quotation-summary">
                <p>
                  {q.status.charAt(0).toUpperCase() + q.status.slice(1)} ·
                  Revision {q.revision}
                </p>
                <h3 dir="auto">{q.clientName || 'Client not added'}</h3>
                {q.clientPhone && <p dir="ltr">{q.clientPhone}</p>}
                {q.clientCompany && <p dir="auto">{q.clientCompany}</p>}
                <strong className="quote-total">
                  {amount(q.total, q.currency)}
                </strong>
                {q.subject && <p dir="auto">{q.subject}</p>}
                {q.projectName && <p dir="auto">{q.projectName}</p>}
              </section>
              <section className="quote-items">
                <h3>Items</h3>
                {data.items.map((item) => (
                  <article
                    key={item.id}
                    className={
                      item.itemType === 'section'
                        ? 'quote-section-item'
                        : 'quote-line-item'
                    }
                  >
                    <h4 dir="auto">
                      {item.description || item.descriptionAr || 'Item'}
                    </h4>
                    {item.description && item.descriptionAr && (
                      <p dir="auto">{item.descriptionAr}</p>
                    )}
                    {item.specification && (
                      <p dir="auto">{item.specification}</p>
                    )}
                    {item.itemType !== 'section' && (
                      <>
                        <p className="muted">
                          {item.qty ?? '—'} {item.unit ?? ''} ×{' '}
                          {amount(item.unitPrice, q.currency)}
                        </p>
                        <strong>{amount(item.lineTotal, q.currency)}</strong>
                      </>
                    )}
                  </article>
                ))}
                {data.items.length === data.itemsLimit && (
                  <p className="muted">
                    Showing the first {data.itemsLimit} rows. The PDF contains
                    the full quotation.
                  </p>
                )}
              </section>
              <section className="quote-facts">
                <dl>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{amount(q.subtotal, q.currency)}</dd>
                  </div>
                  <div>
                    <dt>Discount</dt>
                    <dd>{amount(q.discountAmount, q.currency)}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{amount(q.total, q.currency)}</dd>
                  </div>
                </dl>
              </section>
              {[
                ['Payment', q.paymentTerms],
                ['Delivery', q.deliveryTerms],
                ['Warranty', q.warrantyTerms],
                ['Valid until', q.validUntil],
              ].map(([label, value]) =>
                value ? (
                  <section className="quote-terms" key={label}>
                    <h3>{label}</h3>
                    <p dir="auto">{value}</p>
                  </section>
                ) : null
              )}
              {!document && (
                <p className="quote-guidance">
                  Prepare the current PDF in the CRM to view or share it here.
                </p>
              )}
              {sendState === 'legacy' && (
                <p className="quote-guidance">
                  Saved PDF available. Prepare a current document in the CRM to
                  enable WhatsApp sending.
                </p>
              )}
              {sendState === 'sent' && (
                <p className="quote-guidance">
                  This document has already been accepted for sending. Check the
                  chat for delivery.
                </p>
              )}
              {['sending', 'uncertain'].includes(sendState ?? '') && (
                <p className="quote-guidance">
                  Sending has not been confirmed. Check the chat and refresh
                  status before taking further action.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {notice && (
        <p className="quote-guidance" role="status">
          {notice}
        </p>
      )}
      {preview && error && (
        <p className="quote-guidance" role="alert">
          {error}
        </p>
      )}
      {data && (
        <div className="quotation-actions">
          <button
            className="text"
            disabled={busy || !document}
            onClick={() => void pdf()}
          >
            <FileText size={18} />
            View PDF
          </button>
          <button
            className="text"
            disabled={busy || !document}
            onClick={() => void pdf(true)}
          >
            <Share2 size={18} />
            {Capacitor.getPlatform() === 'android'
              ? 'Share PDF'
              : 'Download PDF'}
          </button>
          {data.conversationId && q && (
            <button
              className="text"
              disabled={busy}
              onClick={() =>
                onOpen({
                  id: data.conversationId!,
                  contact: { name: q.clientName, phone: q.clientPhone ?? '' },
                  last_message_at: null,
                  last_message_text: null,
                })
              }
            >
              <MessageSquare size={18} />
              Open customer chat
            </button>
          )}
          {document?.id &&
            data.conversationId &&
            sendState === 'ready' &&
            !uncertain && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setConfirm(true);
                }}
              >
                <Send size={17} />
                Send on WhatsApp
              </button>
            )}
          {uncertain && (
            <button className="text" disabled={busy} onClick={onRefresh}>
              Refresh status
            </button>
          )}
          {document?.id && !data.conversationId && (
            <p>
              No matching conversation is available. Open the customer chat in
              the CRM first.
            </p>
          )}
        </div>
      )}
      {confirm && q && (
        <SendConfirmation
          busy={busy}
          quote={q}
          caption={caption}
          onCaption={onCaption}
          onCancel={() => {
            if (!busy) setConfirm(false);
          }}
          onSend={() => void send()}
        />
      )}
    </>
  );
}
function SendConfirmation({
  busy,
  quote,
  caption,
  onCaption,
  onCancel,
  onSend,
}: {
  busy: boolean;
  quote: Quote;
  caption: string;
  onCaption: (value: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="task-completion quote-confirmation"
      aria-labelledby="quote-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      <header>
        <h2 id="quote-confirm-title">Send quotation on WhatsApp?</h2>
        <button
          className="icon-button"
          aria-label="Close send confirmation"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={22} />
        </button>
      </header>
      <p dir="auto">{quote.clientName}</p>
      <p dir="ltr">{quote.clientPhone}</p>
      <p>
        {quote.reference} · Revision {quote.revision}
      </p>
      <p>Confirm the recipient and current PDF before sending.</p>
      <label htmlFor="quote-caption">Optional message</label>
      <textarea
        id="quote-caption"
        value={caption}
        maxLength={1024}
        rows={3}
        dir="auto"
        onChange={(e) => onCaption(e.target.value)}
        disabled={busy}
      />
      <div className="quote-confirm-actions">
        <button className="text" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy} onClick={onSend}>
          {busy ? 'Sending…' : 'Confirm and send'}
        </button>
      </div>
    </dialog>
  );
}
