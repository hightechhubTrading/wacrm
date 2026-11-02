'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
type Row = {
  quotation_id: string;
  reason: string;
  follow_up_date: string;
  quotations: {
    reference: string;
    client_name: string | null;
    client_company: string | null;
    status: string;
  };
};
export function FollowupList() {
  const ar = useLocale() === 'ar';
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/quotations/knowledge/followups?page=${page}`, {
      signal: c.signal,
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setRows(b.rows);
        setCount(b.count);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [page]);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {ar ? 'متابعات العروض المحفوظة' : 'Scheduled quotation follow-ups'}
      </h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {rows === null ? (
        <p>…</p>
      ) : !rows.length ? (
        <p>{ar ? 'لا توجد متابعات مجدولة.' : 'No scheduled follow-ups.'}</p>
      ) : (
        <ul className="divide-y rounded border">
          {rows.map((r) => (
            <li key={r.quotation_id} className="space-y-1 p-3">
              <Link
                className="font-semibold underline"
                href={`/quotations/${r.quotation_id}`}
              >
                {r.quotations.reference}
              </Link>
              <p>
                {r.quotations.client_name || r.quotations.client_company} ·{' '}
                {r.quotations.status} ·{' '}
                <time dateTime={r.follow_up_date}>{r.follow_up_date}</time>
              </p>
              <p className="whitespace-pre-wrap">{r.reason}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          {ar ? 'السابق' : 'Previous'}
        </Button>
        <span>{count}</span>
        <Button
          type="button"
          variant="outline"
          disabled={(page + 1) * 50 >= count}
          onClick={() => setPage((p) => p + 1)}
        >
          {ar ? 'التالي' : 'Next'}
        </Button>
      </div>
    </section>
  );
}
