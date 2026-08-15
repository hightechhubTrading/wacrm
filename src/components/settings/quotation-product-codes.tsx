'use client';

import { useEffect, useState } from 'react';
import { RequireRole } from '@/components/auth/require-role';

interface ProductCode {
  code: string;
  label: string;
}

// No accountId prop -- the API route derives it from the caller's own
// session (requireRole), same reasoning as the rest of this feature
// (see the auth comments on src/app/api/quotations/route.ts).
//
// `quotation_product_codes_select` (migration 059) lets any account
// member list codes -- that's why the list below renders for every
// role. Only `quotation_product_codes_write` is admin-only, so the
// add-new-code form is wrapped in `<RequireRole min="admin">` (the
// same client-side gate `MembersTab` uses for its admin-only
// controls). This is a UX nicety, not the security boundary: an
// agent who forges the POST anyway still hits the DB's own
// `quotation_product_codes_write` RLS policy and gets a 400 with
// Postgres's rejection message, same as the route itself does.
export function QuotationProductCodes() {
  const [codes, setCodes] = useState<ProductCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    fetch('/api/quotation-product-codes')
      .then((res) => res.json())
      .then((data) => setCodes(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }
  useEffect(refresh, []);

  async function add() {
    if (!code.trim() || !label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/quotation-product-codes', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim().toUpperCase(), label: label.trim() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Failed to add code');
        return;
      }
      setCode('');
      setLabel('');
      refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Quotation product codes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Prefixes (e.g. PIV, RSD) used when generating quotation reference numbers.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No product codes yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {codes.map((c) => (
            <li key={c.code} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-mono font-medium text-foreground">{c.code}</span>
              <span className="text-muted-foreground">{c.label}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Admin-only in the UI, mirroring quotation_product_codes_write
          (059), which restricts inserts to admin/owner in the DB. */}
      <RequireRole min="admin">
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="qpc-code">
              Code
            </label>
            <input
              id="qpc-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. PRG"
              maxLength={6}
              className="h-8 w-28 rounded-lg border border-input bg-transparent px-2.5 text-sm font-mono text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="qpc-label">
              Label
            </label>
            <input
              id="qpc-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Pergola"
              className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground"
            />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={saving || !code.trim() || !label.trim()}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Adding…' : '+ Add code'}
          </button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </RequireRole>
    </section>
  );
}
