'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Quotation } from '@/lib/quotations/types';

// No accountId prop -- the API route derives it from the caller's own
// session (requireRole), same reasoning as the rest of this feature
// (see the auth comments on src/app/api/quotations/route.ts).
export function QuotationList() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [status, setStatus] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [productCode, setProductCode] = useState('GEN');

  useEffect(() => {
    const params = new URLSearchParams(status ? { status } : {});
    fetch(`/api/quotations?${params}`)
      .then((res) => res.json())
      .then(setQuotations);
  }, [status]);

  // Standalone creation -- no deal or contact required, per spec Goals:
  // "a quotation can exist standalone... optionally linked... later."
  // The deal-card entry point (Task 14) is a second, pre-filled path into
  // the same createQuotation call; this is the one with no prerequisites.
  async function createStandalone() {
    setCreating(true);
    const res = await fetch('/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ productCode, currency: 'QAR' }),
    });
    const created = await res.json();
    window.location.href = `/quotations/${created.id}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={productCode}
          onChange={(e) => setProductCode(e.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground"
        >
          <option value="PIV">Pivot Door</option>
          <option value="RSD">Roll-Up Shutter</option>
          <option value="STL">Steel Door</option>
          <option value="UPV">UPVC</option>
          <option value="GEN">General</option>
        </select>
        <button
          type="button"
          onClick={createStandalone}
          disabled={creating}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? 'Creating…' : '+ New Quotation'}
        </button>
      </div>
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
