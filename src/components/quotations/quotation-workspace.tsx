'use client';
import { recordReliability } from '@/lib/inbox/reliability';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { quotationDelivery } from '@/lib/quotations/product-profile';
import { catalogueTerms } from '@/lib/quotations/catalogue';
import { TermPresetField } from './term-preset-field';
import {
  DEFAULT_INCLUDED,
  DEFAULT_EXCLUDED,
} from '@/lib/quotations/commercial-defaults';
import { PaymentPlanEditor } from './payment-plan-editor';
import {
  validPaymentPlan,
  fitPaymentPlan,
  type PaymentOption,
} from '@/lib/quotations/payment-plan';
import {
  productPaymentOptions,
  type CatalogueProduct,
} from '@/lib/quotations/catalogue';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { WorkspaceSelect } from './workspace-select';

import './workspace.css';
import './product-workspace.css';
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
  validateDraft,
  type QuotationDraft,
  type QuotationWithItems,
} from '@/lib/quotations/workspace';
import type {
  QuotationDocumentDetails,
  QuotationStatus,
} from '@/lib/quotations/types';
import { QuotationFollowup } from './knowledge/quotation-followup';
import { QuotationKnowledgePanel } from './knowledge/quotation-knowledge-panel';
import { applyCatalogueCapture } from '@/lib/quotations/catalogue';
import { WorkspaceItems } from './workspace-items';
import { QuotationDatePicker } from './quotation-date-picker';

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
  const [stage, setStage] = useState(
    initial.items.length || initial.documentDetails?.catalogueSeed ? 1 : 0
  );
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [expanded, setExpanded] = useState(false);
  const [html, setHtml] = useState('');
  const [sourceItem, setSourceItem] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/quotations/catalogue', { signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b && !c.signal.aborted) setCatalogue(b.items);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  const selectedProducts = catalogue.filter((p) =>
    draft.items.some((i) => i.productId === p.id)
  );
  const relatedTermProducts = [
    ...selectedProducts,
    ...catalogue.filter((p) =>
      selectedProducts.some(
        (selected) =>
          (selected.familyName && selected.familyName === p.familyName) ||
          (selected.productCode && selected.productCode === p.productCode)
      )
    ),
  ];
  const recordedPaymentOptions: PaymentOption[] = [];
  for (const product of catalogue.filter((p) =>
    draft.items.some((i) => i.productId === p.id)
  ))
    for (const option of productPaymentOptions(product))
      if (!recordedPaymentOptions.some((o) => o.key === option.key))
        recordedPaymentOptions.push(option);
  const l = (en: string, ar: string) => (locale === 'ar' ? ar : en);
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
  const unpriced = draft.items.some(
    (i) =>
      i.itemType === 'line' &&
      !['Included', 'Optional'].includes(i.kind ?? '') &&
      (i.unitPrice === undefined ||
        !i.unit ||
        (i.unit === 'm2' && (!i.sizeW || !i.sizeH)))
  );
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
    if (!expanded) return;
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
  }, [draft, quotation.id, expanded]);
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setPreviewWidth(entries[0].contentRect.width)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);
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
      setExpanded(false);
      setError(t(invalid));
      return null;
    }
    const started = performance.now();
    try {
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
        recordReliability('quotation.rejected', performance.now() - started);
        setError(translateError(data.error ?? 'saveError'));
        return null;
      }
      recordReliability('quotation.saved', performance.now() - started);
      window.dispatchEvent(new Event('quotations-updated'));
      const next = draftFromQuotation(data);
      setQuotation(data);
      setDraft(next);
      setSaved(JSON.stringify(next));
      setError(null);
      return data;
    } catch (error) {
      recordReliability('quotation.unavailable', performance.now() - started);
      throw error;
    }
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
      setExpanded(false);
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
      return;
    }
    if (send && !draft.clientPhone.trim()) {
      setError(t('phoneRequired'));
      setStage(0);
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
      window.dispatchEvent(new Event('quotations-updated'));
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
      className={`qw-preview ${expanded ? 'qw-preview-expanded' : ''}`}
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
    <div className="qw-workspace qp-workspace">
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
            ref={expandReviewRef}
            onClick={() => {
              setExpanded(true);
            }}
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
        <main className="qw-editor">
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
              itemOptions={details.itemOptions}
              onOptionsChange={(v) => {
                setError(null);
                setDraft((d) => {
                  const previous = quotationDelivery(
                      d.items,
                      d.documentDetails.itemOptions ?? {}
                    ),
                    next = quotationDelivery(d.items, v),
                    plain = (s: string) =>
                      s
                        .replace(/^Delivery\s*(?:\/\s*installation)?:\s*/i, '')
                        .replace(/\.$/, '')
                        .trim();
                  const auto =
                    !d.deliveryTerms ||
                    plain(d.deliveryTerms) === plain(previous) ||
                    (d.items.filter(
                      (i) => i.itemType === 'line' && !i.parentItemId
                    ).length === 1 &&
                      catalogue.some(
                        (p) =>
                          plain(catalogueTerms(p).deliveryTerms) ===
                          plain(d.deliveryTerms)
                      ));
                  return {
                    ...d,
                    deliveryTerms: auto && next ? next : d.deliveryTerms,
                    documentDetails: { ...d.documentDetails, itemOptions: v },
                  };
                });
              }}
              onTools={setSourceItem}
              onCatalogueCapture={(knowledge, terms, itemId, resetPricing) =>
                setDraft((d) =>
                  applyCatalogueCapture(
                    d,
                    knowledge,
                    terms,
                    itemId,
                    resetPricing
                  )
                )
              }
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
                    {unpriced ? '—' : money(totals.total)}{' '}
                    <small>
                      {unpriced
                        ? l('Pricing incomplete', 'التسعير غير مكتمل')
                        : quotation.currency}
                    </small>
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="qw-section" hidden={stage !== 2}>
            <h2>{t('commercialTerms')}</h2>
            {initial.documentDetails?.paymentPlan &&
              initial.documentDetails.paymentPlan.stages.reduce(
                (sum, stage) => sum + stage.percent,
                0
              ) > 100 &&
              dirty && (
                <p role="status" className="qp-guidance">
                  {l(
                    'The previous schedule exceeded 100%. Excess allocation was removed from the last payments; review the corrected schedule before saving.',
                    'تجاوز الجدول السابق 100%. تم تخفيض النسبة الزائدة من الدفعات الأخيرة؛ راجع الجدول المصحح قبل الحفظ.'
                  )}
                </p>
              )}
            <PaymentPlanEditor
              plan={details.paymentPlan}
              options={recordedPaymentOptions}
              total={totals.total}
              currency={quotation.currency}
              disabled={disabled}
              onChange={(plan) => {
                setError(null);
                setDraft((d) => ({
                  ...d,
                  paymentTerms: '',
                  documentDetails: {
                    ...d.documentDetails,
                    paymentPlan: plan ? fitPaymentPlan(plan) : undefined,
                    paymentSchedule: undefined,
                    commercialPreset: undefined,
                  },
                }));
              }}
            />
            <div className="qp-commercial-fields">
              {(['deliveryTerms', 'warrantyTerms'] as const).map((key) => (
                <TermPresetField
                  key={key}
                  label={t(key)}
                  value={draft[key]}
                  disabled={disabled}
                  options={relatedTermProducts.flatMap((p) => [
                    catalogueTerms(p)[key] ?? '',
                    ...(key === 'deliveryTerms' && p.customDeliveryPeriod
                      ? [p.customDeliveryPeriod]
                      : []),
                  ])}
                  onChange={(value) => setField(key, value)}
                />
              ))}
            </div>
            <details className="qw-details">
              <summary>{t('scopeNotes')}</summary>
              <div className="qw-form-grid">
                {(['included', 'excluded', 'notes'] as const).map((key) => (
                  <TermPresetField
                    key={key}
                    label={t(key)}
                    value={details[key] ?? ''}
                    disabled={disabled}
                    optional={key === 'notes'}
                    options={
                      key === 'included'
                        ? [DEFAULT_INCLUDED]
                        : key === 'excluded'
                          ? [DEFAULT_EXCLUDED]
                          : []
                    }
                    onChange={(value) => setDetail(key, value)}
                  />
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
                stage < 2 ? setStage(stage + 1) : setExpanded(true)
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
        <aside
          className="qp-quote-summary"
          aria-label={l('Quotation summary', 'ملخص عرض السعر')}
        >
          <span className="qp-eyebrow">
            {l('Quotation summary', 'ملخص عرض السعر')}
          </span>
          <h3>
            {draft.clientCompany ||
              draft.clientName ||
              l('New customer', 'عميل جديد')}
          </h3>
          <p>{draft.projectName || draft.subject}</p>
          <dl>
            <div>
              <dt>{t('subtotal')}</dt>
              <dd>{money(totals.subtotal)}</dd>
            </div>
            {totals.discountAmount > 0 && (
              <div>
                <dt>{t('discount')}</dt>
                <dd>−{money(totals.discountAmount)}</dd>
              </div>
            )}
            <div className="qp-summary-total">
              <dt>{t('total')}</dt>
              <dd>
                {unpriced ? '—' : money(totals.total)}{' '}
                <small>
                  {unpriced
                    ? l('Pricing incomplete', 'التسعير غير مكتمل')
                    : quotation.currency}
                </small>
              </dd>
            </div>
          </dl>
          <div className="qp-readiness">
            {[
              [
                0,
                !!(draft.clientName || draft.clientCompany) &&
                  !!draft.subject.trim() &&
                  !!draft.validUntil,
                l('Customer & project', 'العميل والمشروع'),
              ],
              [
                1,
                draft.items.some((i) => i.itemType === 'line') &&
                  !draft.items.some(
                    (i) =>
                      i.itemType === 'line' &&
                      !['Included', 'Optional'].includes(i.kind ?? '') &&
                      (i.unitPrice === undefined ||
                        !i.unit ||
                        (i.unit === 'm2' && (!i.sizeW || !i.sizeH)))
                  ),
                l('Products & pricing', 'المنتجات والتسعير'),
              ],
              [
                2,
                !!details.paymentPlan &&
                  validPaymentPlan(details.paymentPlan, true) &&
                  !!draft.deliveryTerms.trim(),
                l('Payment & delivery', 'الدفع والتسليم'),
              ],
            ].map(([index, ready, label]) => (
              <button
                type="button"
                key={String(index)}
                onClick={() => {
                  setStage(Number(index));
                }}
              >
                <span className={ready ? 'qp-good' : 'qp-incomplete'}>
                  {ready ? '✓' : '○'}
                </span>
                {label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setExpanded(true);
            }}
          >
            <Eye size={15} />
            {t('reviewDocument')}
          </Button>
          <p className="qp-subtle">
            {l(
              'Unpriced items and incomplete payment events must be completed before issue.',
              'يجب استكمال البنود غير المسعرة ومواعيد الدفعات قبل إصدار العرض.'
            )}
          </p>
          <details className="qp-followup">
            <summary>{l('Sales follow-up', 'متابعة المبيعات')}</summary>
            <QuotationFollowup key={quotation.id} quotationId={quotation.id} />
          </details>
        </aside>
        <Dialog
          open={!!sourceItem}
          onOpenChange={(v) => {
            if (!v) setSourceItem(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
            <DialogTitle>
              {l('Sources & costing', 'المصادر والتكلفة')}
            </DialogTitle>
            <DialogDescription>
              {draft.items.find((i) => i.id === sourceItem)?.description}
            </DialogDescription>
            {sourceItem && (
              <QuotationKnowledgePanel
                key={sourceItem}
                initialItemId={sourceItem}
                draft={draft}
                onChange={(d) => {
                  setError(null);
                  setDraft(d);
                }}
                disabled={disabled}
              />
            )}
          </DialogContent>
        </Dialog>
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
