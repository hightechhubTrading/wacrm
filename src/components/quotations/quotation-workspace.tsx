'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { WorkspaceSelect } from './workspace-select';

import './workspace.css';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  FileText,
  Loader2,
  Save,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fillQuotationContext } from '@/lib/quotations/context';
import { createClient } from '@/lib/supabase/client';
import { computeQuotationTotals } from '@/lib/quotations/totals';
import {
  draftFromQuotation,
  DEFAULT_COMMERCIAL_TERMS,
  validateDraft,
  type QuotationDraft,
  type QuotationWithItems,
} from '@/lib/quotations/workspace';
import type {
  QuotationDocumentDetails,
  QuotationStatus,
} from '@/lib/quotations/types';
import { WorkspaceItems } from './workspace-items';
import { QuotationDatePicker } from './quotation-date-picker';
import {
  COMMERCIAL_PRESETS,
  applyCommercialPreset,
} from '@/lib/quotations/company-presets';

type DocumentRow = {
  id: string;
  revision: number;
  workspace_version: number;
  storage_path: string;
  created_at: string;
  sent_at: string | null;
  legacy?: boolean;
};
export function QuotationWorkspace({
  initial,
}: {
  initial: QuotationWithItems;
}) {
  const t = useTranslations('QuotationWorkspace');
  const locale = useLocale();
  const [quotation, setQuotation] = useState(initial);
  const [draft, setDraft] = useState(() => draftFromQuotation(initial));
  const [saved, setSaved] = useState(() =>
    JSON.stringify(draftFromQuotation(initial, false))
  );
  const [busy, setBusy] = useState<
    'save' | 'pdf' | 'send' | 'revise' | 'status' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [stage, setStage] = useState(0);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [expanded, setExpanded] = useState(false);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [html, setHtml] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [contacts, setContacts] = useState<
    {
      id: string;
      name: string | null;
      phone: string;
      company?: string | null;
    }[]
  >([]);
  const [contactQuery, setContactQuery] = useState('');
  const [deals, setDeals] = useState<
    { id: string; title: string; contact_id: string | null }[]
  >([]);
  const [linkError, setLinkError] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const expandReviewRef = useRef<HTMLButtonElement>(null);
  const closeReviewRef = useRef<HTMLButtonElement>(null);
  const [previewWidth, setPreviewWidth] = useState(450);
  const dirty = JSON.stringify(draft) !== saved;
  const locked = quotation.status !== 'draft';
  const disabled = busy !== null || locked;
  const totals = computeQuotationTotals(draft.items, draft.orderDiscount);
  const translateError = (code: string) => (t.has(code) ? t(code) : code);
  const money = (n: number) =>
    n.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const details = draft.documentDetails;
  const setField = <K extends keyof QuotationDraft>(
    key: K,
    value: QuotationDraft[K]
  ) => {
    setError(null);
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...([
        'deliveryTerms',
        'paymentTerms',
        'warrantyTerms',
        'validUntil',
      ].includes(key)
        ? {
            documentDetails: {
              ...d.documentDetails,
              commercialPreset: undefined,
            },
          }
        : {}),
    }));
  };
  const setDetail = <K extends keyof QuotationDocumentDetails>(
    key: K,
    value: QuotationDocumentDetails[K]
  ) =>
    setField('documentDetails', {
      ...details,
      ...(key === 'paymentSchedule' ? { commercialPreset: undefined } : {}),
      [key]: value,
    });
  async function loadDocuments() {
    const res = await fetch(`/api/quotations/${quotation.id}/documents`);
    if (res.ok) setDocuments(await res.json());
  }
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quotations/${initial.id}/documents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initial.id]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const links = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest('a');
      if (
        dirty &&
        anchor?.href &&
        anchor.target !== '_blank' &&
        new URL(anchor.href).pathname !== window.location.pathname &&
        !window.confirm(t('leaveConfirm'))
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', prevent);
    document.addEventListener('click', links, true);
    return () => {
      window.removeEventListener('beforeunload', prevent);
      document.removeEventListener('click', links, true);
    };
  }, [dirty, t]);
  useEffect(() => {
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      if (validateDraft(draft)) {
        setPreviewLoading(false);
        setPreviewError(true);
        return;
      }
      setPreviewLoading(true);
      setPreviewError(false);
      fetch(`/api/quotations/${quotation.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setHtml(data.html);
          setPreviewLoading(false);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') {
            setPreviewLoading(false);
            setPreviewError(true);
          }
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, quotation.id]);
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setPreviewWidth(entries[0].contentRect.width)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [showPreview, mobileView, expanded]);
  useEffect(() => {
    if (contactQuery.length < 2) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await createClient()
        .from('contacts')
        .select('id,name,phone,company')
        .eq('account_id', quotation.accountId)
        .or(
          `name.ilike.%${contactQuery.replace(/[^\p{L}\p{N} +@.-]/gu, '')}%,phone.ilike.%${contactQuery.replace(/[^0-9+]/g, '') || 'no-phone-match'}%`
        )
        .limit(8);
      if (!cancelled) {
        setContacts(data ?? []);
        setLinkError(!!error);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [contactQuery, quotation.accountId]);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('deals')
      .select('id,title,contact_id')
      .eq('account_id', quotation.accountId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!cancelled) {
          setDeals(data ?? []);
          setLinkError(!!error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [quotation.accountId]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function fillFromDeal(id: string) {
    const deal = deals.find((entry) => entry.id === id);
    setField('dealId', id || null);
    if (!deal) return;
    setDraft((current) => fillQuotationContext(current, deal));
    if (
      !deal.contact_id ||
      (draft.contactId && draft.contactId !== deal.contact_id)
    )
      return;
    const { data, error } = await createClient()
      .from('contacts')
      .select('id,name,phone,company')
      .eq('account_id', quotation.accountId)
      .eq('id', deal.contact_id)
      .maybeSingle();
    if (error) {
      setLinkError(true);
      return;
    }
    if (data) setDraft((current) => fillQuotationContext(current, deal, data));
  }

  useEffect(() => {
    if (
      !locked &&
      draft.dealId &&
      deals.length &&
      (!draft.projectName || !draft.clientPhone)
    ) {
      void fillFromDeal(draft.dealId);
    }
    // Only hydrate when the deal list first becomes available. Preserve subsequent edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals]);

  async function persist(revise = false): Promise<QuotationWithItems | null> {
    const invalid = validateDraft(draft);
    if (invalid) {
      setError(t(invalid));
      return null;
    }
    const res = await fetch(`/api/quotations/${quotation.id}/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft,
        version: quotation.workspaceVersion ?? 0,
        revise,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(translateError(data.error ?? 'saveError'));
      return null;
    }
    const next = draftFromQuotation(data);
    setQuotation(data);
    setDraft(next);
    setSaved(JSON.stringify(next));
    setError(null);
    return data;
  }
  async function save(revise = false) {
    setBusy(revise ? 'revise' : 'save');
    try {
      await persist(revise);
    } catch {
      setError(t('saveError'));
    } finally {
      setBusy(null);
    }
  }
  async function exportDocument(send = false) {
    const invalid = validateDraft(draft, true, quotation.currency);
    if (invalid) {
      setError(t(invalid));
      setStage(
        [
          'customerRequired',
          'subjectRequired',
          'validityRequired',
          'unsupportedCurrency',
        ].includes(invalid)
          ? 0
          : ['termsRequired', 'invalidSchedule'].includes(invalid)
            ? 2
            : 1
      );
      setMobileView('edit');
      return;
    }
    if (send && !draft.clientPhone.trim()) {
      setError(t('phoneRequired'));
      setStage(0);
      setMobileView('edit');
      return;
    }
    setBusy(send ? 'send' : 'pdf');
    setError(null);
    try {
      const q = dirty ? await persist() : quotation;
      if (!q) return;
      const res = await fetch(`/api/quotations/${q.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: q.workspaceVersion ?? 0 }),
      });
      const generated = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(translateError(generated.error ?? 'exportError'));
        return;
      }
      setQuotation((prev) => ({
        ...prev,
        pdfStoragePath: generated.storagePath,
      }));
      await loadDocuments();
      if (send) {
        const prepared = await fetch(`/api/quotations/${q.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: generated.documentId }),
        });
        const data = await prepared.json().catch(() => ({}));
        if (!prepared.ok) {
          setError(translateError(data.error ?? 'sendError'));
          return;
        }
        window.location.assign(
          `${data.inboxUrl}&quotation=${encodeURIComponent(q.id)}&document=${encodeURIComponent(generated.documentId)}`
        );
      } else {
        const anchor = document.createElement('a');
        anchor.href = generated.publicUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.click();
      }
    } catch {
      setError(t(send ? 'sendError' : 'exportError'));
    } finally {
      setBusy(null);
    }
  }
  async function outcome(status: QuotationStatus) {
    setBusy('status');
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { status } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(translateError(data.error ?? 'saveError'));
        return;
      }
      setQuotation((q) => ({ ...q, ...data }));
      toast.success(t('saved'));
    } catch {
      setError(t('saveError'));
    } finally {
      setBusy(null);
    }
  }
  function field(
    key:
      | 'clientName'
      | 'clientPhone'
      | 'clientCompany'
      | 'projectName'
      | 'location'
      | 'subject'
      | 'validUntil',
    label: string,
    type = 'text'
  ) {
    return (
      <label>
        {t(label)}
        <Input
          type={type}
          dir={type === 'tel' ? 'ltr' : 'auto'}
          value={draft[key]}
          disabled={disabled}
          onChange={(e) => setField(key, e.target.value)}
        />
      </label>
    );
  }
  function back() {
    if (!dirty || window.confirm(t('leaveConfirm')))
      window.location.assign('/quotations');
  }
  const currentPdf = documents.find(
    (d) => !d.legacy && d.workspace_version === quotation.workspaceVersion
  );
  const expired =
    !!draft.validUntil &&
    draft.validUntil <
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' });
  const previewPanel = (
    <aside
      ref={previewRef}
      className={`qw-preview ${expanded ? 'qw-preview-expanded' : ''} ${mobileView === 'edit' ? 'qw-mobile-hidden' : ''}`}
      aria-label={t('documentPreview')}
    >
      <div className="qw-preview-toolbar">
        <div>
          <strong>{t('documentPreview')}</strong>
          <small role="status">
            {previewLoading
              ? t('updatingPreview')
              : previewError
                ? t('previewError')
                : dirty
                  ? t('draftPreview')
                  : currentPdf
                    ? t('pdfCurrent')
                    : t('readyToExport')}
          </small>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => exportDocument()}
        >
          <Download size={15} />
          {t('downloadPdf')}
        </Button>
      </div>
      <div className="qw-zoom-controls">
        <button
          type="button"
          aria-label={t('zoomOut')}
          onClick={() =>
            setZoom(
              Math.max(
                25,
                (zoom === 'fit'
                  ? Math.round(((previewWidth - 24) / 855) * 100)
                  : zoom) - 25
              )
            )
          }
        >
          −
        </button>
        <WorkspaceSelect
          aria-label={t('zoom')}
          value={zoom}
          onValueChange={(value) =>
            setZoom(value === 'fit' ? 'fit' : Number(value))
          }
        >
          <option value="fit">{t('fitWidth')}</option>
          {[25, 50, 75, 100, 125, 150, 200].map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
          {zoom !== 'fit' &&
            ![25, 50, 75, 100, 125, 150, 200].includes(zoom) && (
              <option value={zoom}>{zoom}%</option>
            )}
        </WorkspaceSelect>
        <button
          type="button"
          aria-label={t('zoomIn')}
          onClick={() =>
            setZoom(
              Math.min(
                200,
                (zoom === 'fit'
                  ? Math.round(((previewWidth - 24) / 855) * 100)
                  : zoom) + 25
              )
            )
          }
        >
          +
        </button>
        <button
          type="button"
          ref={expanded ? closeReviewRef : expandReviewRef}
          onClick={() => {
            setExpanded(!expanded);
            setZoom('fit');
          }}
        >
          {t(expanded ? 'closeReview' : 'expandReview')}
        </button>
      </div>
      <div className="qw-paper-view">
        {html ? (
          <iframe
            title={t('documentPreview')}
            sandbox=""
            srcDoc={html.replace(
              '</head>',
              `<style>body{zoom:${zoom === 'fit' ? Math.max(0.1, (previewWidth - 24) / 855) : zoom / 100};}</style></head>`
            )}
          />
        ) : (
          <div className="qw-preview-empty">
            <FileText size={40} />
            <p>{previewError ? t('previewError') : t('loadingPreview')}</p>
          </div>
        )}
      </div>
    </aside>
  );
  return (
    <div className={`qw-workspace ${showPreview ? '' : 'qw-no-preview'}`}>
      <header className="qw-header">
        <div className="qw-heading">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('back')}
            onClick={back}
          >
            <ArrowLeft size={18} />
          </Button>
          <div>
            <p>{t('quotation')}</p>
            <h1>
              {quotation.reference}
              <span
                className="crm-quotation-status"
                data-status={quotation.status}
              >
                {t(quotation.status)}
              </span>
            </h1>
            <small>
              {t('revision')} {String(quotation.revision).padStart(2, '0')} ·{' '}
              {quotation.currency}
            </small>
          </div>
        </div>
        <div className="qw-header-actions">
          <span
            className="qw-save-state"
            data-state={busy ? 'working' : dirty ? 'unsaved' : 'saved'}
            role="status"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : dirty ? (
              <span className="qw-dirty-dot" />
            ) : (
              <Check size={14} />
            )}{' '}
            {busy ? t('working') : dirty ? t('unsaved') : t('saved')}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="qw-desktop-preview-toggle"
            onClick={() => setShowPreview((v) => !v)}
          >
            <Eye size={16} />
            {t('preview')}
          </Button>
          {!locked && (
            <Button
              type="button"
              variant="success"
              disabled={busy !== null || !dirty}
              onClick={() => save()}
            >
              <Save size={16} />
              {t('saveDraft')}
            </Button>
          )}
          <Button
            type="button"
            variant="info"
            disabled={busy !== null}
            onClick={() => exportDocument(true)}
          >
            <Send size={16} />
            {t('prepareWhatsApp')}
          </Button>
        </div>
      </header>
      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="qw-alert qw-error"
        >
          {error}
          {error === t('conflict') && (
            <Button
              variant="outline"
              onClick={() => {
                if (window.confirm(t('leaveConfirm'))) window.location.reload();
              }}
            >
              {t('reload')}
            </Button>
          )}
        </div>
      )}
      {locked && (
        <div className="qw-alert">
          <FileText size={17} />
          <span>{t('lockedHint')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => save(true)}
          >
            {t('createRevision')}
          </Button>
          {!dirty && (
            <WorkspaceSelect
              aria-label={t('outcome')}
              value={quotation.status}
              disabled={busy !== null}
              onValueChange={(value) => outcome(value as QuotationStatus)}
            >
              <option value={quotation.status}>{t(quotation.status)}</option>
              {['won', 'lost', 'expired']
                .filter((s) => s !== quotation.status)
                .map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
            </WorkspaceSelect>
          )}
        </div>
      )}
      {expired && !['won', 'lost'].includes(quotation.status) && (
        <p className="qw-alert">{t('expiredHint')}</p>
      )}
      <nav className="qw-mobile-tabs" aria-label={t('view')}>
        <button
          type="button"
          aria-pressed={mobileView === 'edit'}
          onClick={() => setMobileView('edit')}
        >
          {t('edit')}
        </button>
        <button
          type="button"
          aria-pressed={mobileView === 'preview'}
          onClick={() => setMobileView('preview')}
        >
          {t('preview')}
        </button>
      </nav>
      <nav className="qw-stage-nav" aria-label={t('workflow')}>
        {['customerProject', 'productsServices', 'commercialTerms'].map(
          (label, index) => (
            <button
              key={label}
              type="button"
              data-ui-area={['people', 'sales', 'operations'][index]}
              aria-current={stage === index ? 'step' : undefined}
              onClick={() => {
                setStage(index);
                setMobileView('edit');
              }}
            >
              <span>{index + 1}</span>
              {t(label)}
            </button>
          )
        )}
      </nav>
      <div className="qw-context-summary">
        <strong>
          {draft.clientName || draft.clientCompany || t('clientName')}
        </strong>
        <span>{draft.projectName || t('project')}</span>
        <span dir="ltr">{draft.clientPhone}</span>
        <strong>
          {quotation.currency} {money(totals.total)}
        </strong>
      </div>
      <div className="qw-columns">
        <main
          className={`qw-editor ${mobileView === 'preview' ? 'qw-mobile-hidden' : ''}`}
        >
          <section className="qw-section" hidden={stage !== 0}>
            <div className="qw-section-title">
              <h2>{t('customerProject')}</h2>
              <small>{t('optionalLink')}</small>
            </div>
            {!locked && (
              <div className="qw-contact-search">
                <Input
                  aria-label={t('findContact')}
                  placeholder={t('findContact')}
                  value={contactQuery}
                  disabled={disabled}
                  onChange={(e) => setContactQuery(e.target.value)}
                />
                {contacts.length > 0 && (
                  <div className="qw-catalog-results">
                    {contacts.map((contact) => (
                      <button
                        type="button"
                        key={contact.id}
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            contactId: contact.id,
                            clientName: d.clientName || contact.name || '',
                            clientPhone: d.clientPhone || contact.phone,
                            clientCompany:
                              d.clientCompany || contact.company || '',
                          }));
                          setContactQuery('');
                        }}
                      >
                        <span>{contact.name ?? contact.phone}</span>
                        <small dir="ltr">{contact.phone}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {draft.contactId && (
              <div className="qw-linked">
                <a href={`/contacts/${draft.contactId}`}>
                  {t('linkedContact')}
                </a>
                {!locked && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setField('contactId', null)}
                  >
                    {t('unlink')}
                  </button>
                )}
              </div>
            )}
            <div className="qw-form-grid">
              {field('clientName', 'clientName')}
              {field('clientPhone', 'phone', 'tel')}
              {field('clientCompany', 'company')}
              {field('projectName', 'project')}
              {field('location', 'location')}
              <label>
                {t('deal')}
                <WorkspaceSelect
                  value={draft.dealId ?? ''}
                  disabled={disabled}
                  onValueChange={(value) => void fillFromDeal(value)}
                >
                  <option value="">{t('standalone')}</option>
                  {draft.dealId &&
                    !deals.some((d) => d.id === draft.dealId) && (
                      <option value={draft.dealId}>{t('linkedDeal')}</option>
                    )}
                  {deals
                    .filter(
                      (d) =>
                        !draft.contactId ||
                        d.contact_id === draft.contactId ||
                        d.id === draft.dealId
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                </WorkspaceSelect>
              </label>
            </div>
            {linkError && <p className="qw-hint">{t('linkLoadError')}</p>}
          </section>
          <section className="qw-section" hidden={stage !== 0}>
            <h2>{t('quotationDetails')}</h2>
            <div className="qw-form-grid">
              {field('subject', 'subject')}
              <QuotationDatePicker
                value={draft.validUntil}
                onChange={(value) => setField('validUntil', value)}
                disabled={disabled}
              />
            </div>
            <details className="qw-details">
              <summary>{t('moreDetails')}</summary>
              <div className="qw-form-grid">
                <label>
                  {t('subjectAr')}
                  <Input
                    dir="rtl"
                    value={details.subjectAr ?? ''}
                    disabled={disabled}
                    onChange={(e) => setDetail('subjectAr', e.target.value)}
                  />
                </label>
                <label>
                  {t('consultant')}
                  <Input
                    value={details.consultant ?? ''}
                    disabled={disabled}
                    onChange={(e) => setDetail('consultant', e.target.value)}
                  />
                </label>
              </div>
            </details>
          </section>
          <section className="qw-section qw-products" hidden={stage !== 1}>
            <div className="qw-section-title">
              <h2>{t('productsServices')}</h2>
              <small>
                {t('itemCount', {
                  count: draft.items.filter(
                    (i) => i.itemType === 'line' && !i.parentItemId
                  ).length,
                })}
              </small>
            </div>
            <WorkspaceItems
              items={draft.items}
              onChange={(items) => setField('items', items)}
              disabled={disabled}
              currency={quotation.currency}
            />
            <div className="qw-totals">
              <div className="qw-order-discount">
                {!draft.orderDiscount ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      setField('orderDiscount', {
                        discountType: 'percent',
                        discountValue: 0,
                      })
                    }
                  >
                    {t('addDiscount')}
                  </Button>
                ) : (
                  <label>
                    {t('quotationDiscount')}
                    <div className="qw-inline">
                      <Input
                        aria-label={t('discount')}
                        type="number"
                        min="0"
                        step="any"
                        disabled={disabled}
                        value={draft.orderDiscount.discountValue}
                        onChange={(e) =>
                          setField('orderDiscount', {
                            ...draft.orderDiscount!,
                            discountValue: Number(e.target.value),
                          })
                        }
                      />
                      <WorkspaceSelect
                        aria-label={t('discountType')}
                        disabled={disabled}
                        value={draft.orderDiscount.discountType}
                        onValueChange={(value) =>
                          setField('orderDiscount', {
                            ...draft.orderDiscount!,
                            discountType: value as 'percent' | 'fixed',
                          })
                        }
                      >
                        <option value="percent">%</option>
                        <option value="fixed">{quotation.currency}</option>
                      </WorkspaceSelect>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setField('orderDiscount', undefined)}
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </label>
                )}
              </div>
              <dl>
                <div hidden={totals.discountAmount === 0}>
                  <dt>{t('subtotal')}</dt>
                  <dd>{money(totals.subtotal)}</dd>
                </div>
                {totals.discountAmount > 0 && (
                  <div>
                    <dt>{t('discount')}</dt>
                    <dd>−{money(totals.discountAmount)}</dd>
                  </div>
                )}
                <div className="qw-grand-total">
                  <dt>{t('total')}</dt>
                  <dd>
                    {money(totals.total)} <small>{quotation.currency}</small>
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="qw-section" hidden={stage !== 2}>
            <h2>{t('commercialTerms')}</h2>
            <div className="qw-commercial-preset">
              <label>
                {t('commercialPreset')}
                <WorkspaceSelect
                  aria-label={t('commercialPreset')}
                  disabled={disabled}
                  value={details.commercialPreset ?? ''}
                  onValueChange={(value) => {
                    if (!value) {
                      setDetail('commercialPreset', undefined);
                      return;
                    }
                    setError(null);
                    setDraft((d) =>
                      applyCommercialPreset(
                        d,
                        value,
                        new Date().toLocaleDateString('en-CA', {
                          timeZone: 'Asia/Qatar',
                        })
                      )
                    );
                  }}
                >
                  <option value="">{t('customTerms')}</option>
                  {COMMERCIAL_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {t(preset.key)}
                    </option>
                  ))}
                </WorkspaceSelect>
              </label>
              <p>{t('commercialReviewHint')}</p>
            </div>
            <div className="qw-form-grid">
              {(
                ['deliveryTerms', 'warrantyTerms', 'paymentTerms'] as const
              ).map((key) => (
                <label
                  key={key}
                  className={key === 'paymentTerms' ? 'qw-full' : ''}
                >
                  {t(
                    key === 'paymentTerms' && details.paymentSchedule
                      ? 'additionalPaymentNotes'
                      : key
                  )}
                  <textarea
                    aria-label={t(
                      key === 'paymentTerms' && details.paymentSchedule
                        ? 'additionalPaymentNotes'
                        : key
                    )}
                    placeholder={
                      key === 'paymentTerms' && details.paymentSchedule
                        ? t('paymentNotesPlaceholder')
                        : DEFAULT_COMMERCIAL_TERMS[key]
                    }
                    dir="auto"
                    rows={3}
                    value={draft[key]}
                    disabled={disabled}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <details
              className="qw-details"
              open={details.paymentSchedule ? true : undefined}
            >
              <summary>{t('paymentSchedule')}</summary>
              <p className="qw-hint">{t('scheduleHint')}</p>
              {!details.paymentSchedule ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    setDetail('paymentSchedule', {
                      advance: 0,
                      delivery: 0,
                      completion: 0,
                    })
                  }
                >
                  {t('addSchedule')}
                </Button>
              ) : (
                <>
                  <div className="qw-form-grid qw-three">
                    {(['advance', 'delivery', 'completion'] as const).map(
                      (key) => (
                        <label key={key}>
                          {t(
                            key === 'delivery' &&
                              details.paymentSchedule?.deliveryTrigger ===
                                'before_installation'
                              ? 'beforeInstallation'
                              : key
                          )}{' '}
                          (%)
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            disabled={disabled}
                            value={details.paymentSchedule![key]}
                            onChange={(e) =>
                              setDetail('paymentSchedule', {
                                ...details.paymentSchedule!,
                                [key]: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      )
                    )}
                  </div>
                  <label className="qw-balance-trigger">
                    {t('balanceDue')}
                    <WorkspaceSelect
                      aria-label={t('balanceDue')}
                      disabled={disabled}
                      value={
                        details.paymentSchedule.deliveryTrigger ?? 'on_delivery'
                      }
                      onValueChange={(value) =>
                        setDetail('paymentSchedule', {
                          ...details.paymentSchedule!,
                          deliveryTrigger: value as
                            'before_installation' | 'on_delivery',
                        })
                      }
                    >
                      <option value="before_installation">
                        {t('beforeInstallation')}
                      </option>
                      <option value="on_delivery">{t('delivery')}</option>
                    </WorkspaceSelect>
                  </label>
                  <p className="qw-hint">
                    {t('scheduleTotal', {
                      total:
                        details.paymentSchedule.advance +
                        details.paymentSchedule.delivery +
                        details.paymentSchedule.completion,
                    })}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => setDetail('paymentSchedule', undefined)}
                  >
                    {t('removeSchedule')}
                  </Button>
                </>
              )}
            </details>
            <details className="qw-details">
              <summary>{t('scopeNotes')}</summary>
              <div className="qw-form-grid">
                {(['included', 'excluded', 'notes'] as const).map((key) => (
                  <label key={key} className={key === 'notes' ? 'qw-full' : ''}>
                    {t(key)}
                    <textarea
                      aria-label={t(key)}
                      rows={key === 'notes' ? 3 : 5}
                      value={details[key] ?? ''}
                      disabled={disabled}
                      onChange={(e) => setDetail(key, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  {t('shopDrawingDays')}
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={details.shopDrawingDays ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      setDetail(
                        'shopDrawingDays',
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value)
                      )
                    }
                  />
                </label>
                <label>
                  {t('preparedBy')}
                  <Input
                    value={details.preparedBy ?? ''}
                    disabled={disabled}
                    onChange={(e) => setDetail('preparedBy', e.target.value)}
                  />
                </label>
                <label>
                  {t('repPhone')}
                  <Input
                    dir="ltr"
                    type="tel"
                    value={details.repPhone ?? ''}
                    disabled={disabled}
                    onChange={(e) => setDetail('repPhone', e.target.value)}
                  />
                </label>
              </div>
            </details>
          </section>
          <div className="qw-stage-actions">
            <Button
              variant="outline"
              disabled={stage === 0}
              onClick={() => setStage(stage - 1)}
            >
              {t('previousStage')}
            </Button>
            <Button
              onClick={() =>
                stage < 2
                  ? setStage(stage + 1)
                  : (setShowPreview(true), setMobileView('preview'))
              }
            >
              {stage < 2 ? t('nextStage') : t('reviewDocument')}
            </Button>
          </div>
          {documents.length > 0 && (
            <section className="qw-section">
              <details className="qw-details">
                <summary>{t('documentHistory')}</summary>
                <div className="qw-history">
                  {documents.map((doc) => (
                    <a
                      key={doc.id}
                      href={
                        createClient()
                          .storage.from('quotation-pdfs')
                          .getPublicUrl(doc.storage_path).data.publicUrl
                      }
                      target="_blank"
                      rel="noopener"
                    >
                      <FileText size={16} />
                      <span>
                        {t('revision')} {String(doc.revision).padStart(2, '0')}
                        <small>
                          {new Date(doc.created_at).toLocaleString(locale)}
                        </small>
                      </span>
                      <small>
                        {doc.legacy
                          ? t('importedDocument')
                          : doc.sent_at
                            ? t('sent')
                            : t('generated')}
                      </small>
                    </a>
                  ))}
                </div>
              </details>
            </section>
          )}
          <footer className="qw-editor-footer">
            <span>
              {money(totals.total)} {quotation.currency}
            </span>
            {!locked && (
              <Button
                type="button"
                variant="success"
                disabled={busy !== null || !dirty}
                onClick={() => save()}
              >
                <Save size={16} />
                {t('saveDraft')}
              </Button>
            )}
          </footer>
        </main>
        {!expanded && previewPanel}
        <DialogPrimitive.Root open={expanded} onOpenChange={setExpanded}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className="qw-review-backdrop" />
            <DialogPrimitive.Popup
              className="qw-review-dialog"
              initialFocus={closeReviewRef}
              finalFocus={expandReviewRef}
            >
              <DialogPrimitive.Title className="sr-only">
                {t('documentPreview')}
              </DialogPrimitive.Title>
              {expanded && previewPanel}
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>
    </div>
  );
}
