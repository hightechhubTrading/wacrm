'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import type { KnowledgeRecord } from '@/lib/quotations/knowledge/types';
import { Button } from '@/components/ui/button';
export function ArchiveHistory({
  client,
  onClose,
}: {
  client: KnowledgeRecord;
  onClose: () => void;
}) {
  const ar = useLocale() === 'ar';
  const [rows, setRows] = useState<KnowledgeRecord[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/quotations/knowledge/history?client=${client.id}`, {
      signal: c.signal,
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setRows(b);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [client.id]);
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex justify-between gap-2">
        <strong>{client.data.client_key}</strong>
        <Button type="button" variant="ghost" onClick={onClose}>
          {ar ? 'إغلاق' : 'Close'}
        </Button>
      </div>
      <p>
        {ar
          ? 'المطابقة بأسماء العميل البديلة، وتحتاج مراجعة بشرية. لا تجمع قيم المراحل أو نسخ العروض.'
          : 'Matched by client spelling aliases; review matches manually. Stage invoices and quote revisions must not be added together.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {rows === null ? (
        <p>…</p>
      ) : (
        <>
          <p>
            {rows.filter((r) => r.kind === 'quotation').length}{' '}
            {ar ? 'عروض' : 'quotes'} ·{' '}
            {rows.filter((r) => r.kind === 'job').length}{' '}
            {ar ? 'أعمال بفواتير' : 'billed job records'}
          </p>
          <ul className="divide-y">
            {rows.map((r) => (
              <li className="space-y-1 py-2" key={r.id}>
                <strong>
                  {r.kind} ·{' '}
                  {r.data['Reference (as typed)'] ||
                    r.data['Invoice ref'] ||
                    r.data['Quote ref(s)'] ||
                    r.record_key}
                </strong>
                <p>
                  {r.data['Project'] || r.data['Project(s)'] || r.data.Product}{' '}
                  ·{' '}
                  {r.data.Date ||
                    r.data['Invoice date'] ||
                    r.data['Last invoice']}
                </p>
                <p>
                  {r.kind === 'quotation'
                    ? r.data['Status (fill in)'] ||
                      (ar ? 'النتيجة غير معروفة' : 'Outcome unknown')
                    : ar
                      ? 'دليل فاتورة؛ السداد غير مؤكد'
                      : 'Invoice evidence; payment unconfirmed'}
                </p>
                {r.data['Issues to check'] && (
                  <p className="text-warning">{r.data['Issues to check']}</p>
                )}
                <small className="text-muted-foreground break-all">
                  {r.source}:{r.source_row} ·{' '}
                  {r.data.File || r.data['Example file']}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
