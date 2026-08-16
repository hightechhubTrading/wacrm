'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { Quotation } from '@/lib/quotations/types';
import { pickDefaultProductCode, type ProductCode } from '@/lib/quotations/product-codes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// No accountId prop -- the API route derives it from the caller's own
// session (requireRole), same reasoning as the rest of this feature
// (see the auth comments on src/app/api/quotations/route.ts).
export function QuotationList() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [status, setStatus] = useState<string>('');
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
    const params = new URLSearchParams(status ? { status } : {});
    fetch(`/api/quotations?${params}`)
      .then((res) => res.json())
      .then(setQuotations);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/quotation-product-codes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ProductCode[]) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setProductCodes(list);
        setProductCode((prev) => pickDefaultProductCode(list, prev));
      })
      .finally(() => {
        if (!cancelled) setLoadingCodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      toast.error('Failed to create quotation — check your connection and try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={productCode}
          onValueChange={(v) => v && setProductCode(v)}
          disabled={loadingCodes || creating || productCodes.length === 0}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder={loadingCodes ? 'Loading…' : 'No product codes'} />
          </SelectTrigger>
          <SelectContent>
            {productCodes.map((pc) => (
              <SelectItem key={pc.code} value={pc.code}>
                {pc.label} ({pc.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={createStandalone}
          disabled={creating || !productCode}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? 'Creating…' : '+ New Quotation'}
        </button>
      </div>
      {!loadingCodes && productCodes.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No product codes configured yet — add one under{' '}
          <Link href="/settings?tab=quotation-product-codes" className="text-primary hover:underline">
            Settings
          </Link>{' '}
          before creating a quotation.
        </p>
      )}
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground"
      >
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="sent">Sent</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pe-4 font-medium">Reference</th>
            <th className="py-2 pe-4 font-medium">Client</th>
            <th className="py-2 pe-4 font-medium">Status</th>
            <th className="py-2 pe-4 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {quotations.map((q) => (
            <tr key={q.id} className="border-b border-border">
              <td className="py-2 pe-4">
                <Link href={`/quotations/${q.id}`} className="text-primary hover:underline">
                  {q.reference}
                </Link>
              </td>
              <td className="py-2 pe-4">{q.clientCompany ?? q.clientName ?? '—'}</td>
              <td className="py-2 pe-4">{q.status}</td>
              <td className="py-2 pe-4">
                {q.total.toLocaleString()} {q.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
