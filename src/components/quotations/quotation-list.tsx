'use client';

import { WorkspaceSelect } from './workspace-select';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { FileText, LockKeyhole, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { Quotation } from '@/lib/quotations/types';
import {
  pickDefaultProductCode,
  type ProductCode,
} from '@/lib/quotations/product-codes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// No accountId prop -- the API route derives it from the caller's own
// session (requireRole), same reasoning as the rest of this feature
// (see the auth comments on src/app/api/quotations/route.ts).
export function QuotationList() {
  const t = useTranslations('Workspace');
  const { profileLoading } = useAuth();
  const canAccess = useCan('send-messages');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [querySearch, setQuerySearch] = useState('');
  const pageSize = 25;
  const [creating, setCreating] = useState(false);

  // Product codes are admin-managed (Task 15's Settings page, GET/POST
  // /api/quotation-product-codes) rather than hardcoded here -- a code
  // an admin adds in Settings must be selectable the moment it exists,
  // not only after this component is edited and redeployed. A
  // brand-new account can have zero codes seeded (059's seed step is
  // applied per-account by the app, not yet wired up as of this wave --
  // see 059's "accountless seed" comment) -- creation is disabled with
  // an explanatory message in that case rather than defaulting to a
  // code ("GEN") that might not actually exist for this account.
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [productCode, setProductCode] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuerySearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (profileLoading || !canAccess) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      search: querySearch,
    });
    if (status) params.set('status', status);
    fetch(`/api/quotations?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('load');
        const rows = await res.json();
        if (!Array.isArray(rows)) throw new Error('load');
        if (!controller.signal.aborted) {
          setQuotations(rows);
          setTotal(Number(res.headers.get('X-Total-Count') ?? rows.length));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [status, revision, page, querySearch, profileLoading, canAccess]);

  useEffect(() => {
    if (profileLoading || !canAccess) return;
    let cancelled = false;
    fetch('/api/quotation-product-codes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ProductCode[]) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setProductCodes(list);
        setProductCode((prev) => pickDefaultProductCode(list, prev));
      })
      .catch(() => {
        if (!cancelled) setProductCodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, canAccess]);

  // Standalone creation -- no deal or contact required, per spec Goals:
  // "a quotation can exist standalone... optionally linked... later."
  // The deal-card entry point (Task 14) is a second, pre-filled path into
  // the same createQuotation call; this is the one with no prerequisites.
  async function createStandalone() {
    if (!productCode) return;
    setCreating(true);
    try {
      const res = await fetch('/api/quotations', {
        method: 'POST',
        body: JSON.stringify({ productCode, currency: 'QAR' }),
      });
      if (!res.ok) {
        // A rejected create (e.g. a whitelist-validated field failing,
        // or a genuinely bad payload) must not navigate to
        // /quotations/undefined -- surface the failure instead.
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Failed to create quotation (${res.status})`);
        return;
      }
      const created = await res.json();
      window.location.href = `/quotations/${created.id}`;
    } catch {
      toast.error(
        'Failed to create quotation — check your connection and try again.'
      );
    } finally {
      setCreating(false);
    }
  }

  if (!profileLoading && !canAccess) {
    return (
      <div className="crm-quotation-list">
        <div className="crm-list-state" role="status">
          <LockKeyhole size={30} aria-hidden />
          <h2>{t('quotationAccessTitle')}</h2>
          <p>{t('quotationAccessHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="crm-quotation-list space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={productCode}
          onValueChange={(v) => v && setProductCode(v)}
          disabled={loadingCodes || creating || productCodes.length === 0}
        >
          <SelectTrigger
            size="sm"
            className="w-48"
            aria-label={t('productCode')}
          >
            <SelectValue
              placeholder={loadingCodes ? t('loading') : t('noCodes')}
            />
          </SelectTrigger>
          <SelectContent>
            {productCodes.map((pc) => (
              <SelectItem key={pc.code} value={pc.code}>
                {pc.label} ({pc.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          onClick={createStandalone}
          disabled={creating || !productCode}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-50"
        >
          <Plus size={16} aria-hidden />
          {creating ? t('creating') : t('newQuotation')}
        </Button>
      </div>
      {!loadingCodes && productCodes.length === 0 && (
        <p className="text-muted-foreground text-xs">
          <Link
            href="/settings?tab=quotation-product-codes"
            className="text-primary hover:underline"
          >
            {t('codesHint')}
          </Link>
        </p>
      )}
      <div className="relative max-w-md">
        <Search
          size={15}
          className="text-muted-foreground absolute start-3 top-1/2 -translate-y-1/2"
          aria-hidden
        />
        <input
          aria-label={t('searchQuotations')}
          placeholder={t('searchQuotations')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="border-input h-9 w-full rounded-lg border bg-transparent ps-9 pe-3 text-sm"
        />
      </div>
      <WorkspaceSelect
        aria-label={t('status')}
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        className="qw-status-filter"
      >
        <option value="">{t('allStatuses')}</option>
        <option value="draft">{t('draft')}</option>
        <option value="sent">{t('sent')}</option>
        <option value="won">{t('won')}</option>
        <option value="lost">{t('lost')}</option>
        <option value="expired">{t('expired')}</option>
      </WorkspaceSelect>
      {loading ? (
        <div className="crm-table-skeleton" role="status">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="crm-list-state" role="status">
          <p>{t('loadError')}</p>
          <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
            {t('retry')}
          </Button>
        </div>
      ) : quotations.length === 0 ? (
        <div className="crm-list-state">
          <FileText size={30} aria-hidden />
          <h2>{t('quotationEmpty')}</h2>
          <p>{t('quotationEmptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-start">
                <th className="py-2 pe-4 font-medium">{t('reference')}</th>
                <th className="py-2 pe-4 font-medium">{t('client')}</th>
                <th className="py-2 pe-4 font-medium">{t('status')}</th>
                <th className="py-2 pe-4 font-medium">{t('total')}</th>
                <th className="py-2 pe-4 font-medium">{t('validUntil')}</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id} className="border-border border-b">
                  <td className="py-2 pe-4">
                    <Link
                      href={`/quotations/${q.id}`}
                      className="text-primary hover:underline"
                    >
                      {q.reference}
                    </Link>
                  </td>
                  <td className="py-2 pe-4">
                    {q.clientCompany ?? q.clientName ?? '—'}
                    <small className="text-muted-foreground block">
                      {q.projectName}
                    </small>
                  </td>
                  <td className="py-2 pe-4">
                    <span
                      className="crm-quotation-status"
                      data-status={q.status}
                    >
                      {t(q.status)}
                    </span>
                  </td>
                  <td className="py-2 pe-4">
                    {q.total.toLocaleString()} {q.currency}
                  </td>
                  <td className="text-muted-foreground py-2 pe-4">
                    {q.validUntil ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !loadError && total > pageSize && (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label={t('quotationPagination')}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('previousPage')}
          </Button>
          <span className="text-muted-foreground text-sm" aria-live="polite">
            {t('quotationPageCount', {
              page,
              pages: Math.ceil(total / pageSize),
              total,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * pageSize >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('nextPage')}
          </Button>
        </nav>
      )}
    </div>
  );
}
