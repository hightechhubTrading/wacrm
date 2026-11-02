'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  KNOWLEDGE_KINDS,
  type KnowledgeRecord,
} from '@/lib/quotations/knowledge/types';
import { recordLabel } from '@/lib/quotations/knowledge/calculations';
import { knowledgeLabel } from '@/lib/quotations/knowledge/ui-copy';
import { SourceReview } from './source-review';
export function SourceBrowser({
  onSelect,
  onInspect,
  kinds,
  approvedOnly = false,
  disabled = false,
}: {
  onSelect?: (r: KnowledgeRecord) => void;
  onInspect?: (r: KnowledgeRecord) => void;
  kinds?: string[];
  approvedOnly?: boolean;
  disabled?: boolean;
}) {
  const ar = useLocale() === 'ar';
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState(kinds?.[0] ?? 'product');
  const [status, setStatus] = useState(approvedOnly ? 'approved' : '');
  const [page, setPage] = useState(0);
  const [batch, setBatch] = useState('');
  const [result, setResult] = useState<{
    records: KnowledgeRecord[];
    batches: { id: string; label: string; source_version: string }[];
    count: number;
    canReview: boolean;
  }>({ records: [], batches: [], count: 0, canReview: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<KnowledgeRecord | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const r = await fetch(
          `/api/quotations/knowledge?${new URLSearchParams({ q: query, kind, status, page: String(page), batch })}`,
          { signal: abort.signal }
        );
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setResult(b);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [query, kind, status, page, batch, refresh]);
  async function importPack(file: File) {
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/quotations/knowledge/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setBatch(b.batchId);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1">
          {ar ? 'بحث في المصادر' : 'Search sources'}
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
              setSelected(null);
            }}
          />
        </label>
        <label>
          {ar ? 'النوع' : 'Type'}
          <select
            className="bg-background h-9 max-w-56 rounded-md border px-2"
            aria-label={ar ? 'نوع المصدر' : 'Source type'}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(0);
              setSelected(null);
            }}
          >
            {(kinds ?? KNOWLEDGE_KINDS).map((k) => (
              <option key={k} value={k}>
                {knowledgeLabel(k, ar)}
              </option>
            ))}
          </select>
        </label>
        {!approvedOnly && (
          <label>
            {ar ? 'المراجعة' : 'Review'}
            <select
              className="bg-background h-9 rounded-md border px-2"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">{ar ? 'الكل' : 'All'}</option>
              {['pending', 'approved', 'rejected'].map((s) => (
                <option key={s} value={s}>
                  {knowledgeLabel(s, ar)}
                </option>
              ))}
            </select>
          </label>
        )}
        {result.batches.length > 1 && (
          <label>
            {ar ? 'نسخة المصادر' : 'Source version'}
            <select
              className="bg-background h-9 max-w-56 rounded-md border px-2"
              value={batch || result.batches[0]?.id}
              onChange={(e) => {
                setBatch(e.target.value);
                setPage(0);
              }}
            >
              {result.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} · {b.source_version.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-muted-foreground">
        {ar
          ? 'بيانات الأرشيف للمراجعة. الفاتورة لا تثبت السداد، وعدم وجود فاتورة لا يعني خسارة العرض.'
          : 'Archive evidence for review. Invoices do not prove payment; unmatched quotes have unknown outcomes.'}
      </p>
      {result.canReview && !onSelect && (
        <label className="block">
          {ar
            ? 'استيراد ملف المصادر الخاص بالحساب'
            : 'Import source pack into this account'}
          <Input
            type="file"
            accept="application/json,.json"
            disabled={loading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importPack(f);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : !result.records.length ? (
        <p>{ar ? 'لا توجد سجلات مطابقة.' : 'No matching source records.'}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {result.records.map((r) => (
            <li
              key={r.id}
              className="flex min-w-0 flex-wrap items-center gap-2 p-3"
            >
              <div className="min-w-0 flex-1">
                <strong className="break-words">{recordLabel(r)}</strong>
                <p className="text-muted-foreground text-xs break-all">
                  {r.source}:{r.source_row} ·{' '}
                  {knowledgeLabel(r.review_status, ar)} · v{r.review_version}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelected(r);
                  onInspect?.(r);
                }}
              >
                {ar ? 'التفاصيل' : 'Details'}
              </Button>
              {onSelect && (
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled || r.review_status !== 'approved'}
                  onClick={() => onSelect(r)}
                >
                  {ar ? 'اختيار' : 'Select'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!page || loading}
          onClick={() => {
            setPage((p) => p - 1);
            setSelected(null);
          }}
        >
          {ar ? 'السابق' : 'Previous'}
        </Button>
        <span>
          {result.count ? page * 50 + 1 : 0}–
          {Math.min((page + 1) * 50, result.count)} / {result.count}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={(page + 1) * 50 >= result.count || loading}
          onClick={() => {
            setPage((p) => p + 1);
            setSelected(null);
          }}
        >
          {ar ? 'التالي' : 'Next'}
        </Button>
      </div>
      {selected && (
        <section className="bg-muted/30 space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <strong>{recordLabel(selected)}</strong>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelected(null)}
            >
              {ar ? 'إغلاق' : 'Close'}
            </Button>
          </div>
          {selected.data.__parse_review_note && (
            <p className="text-warning text-sm">
              {ar ? 'مراجعة تنسيق المصدر: ' : 'Source parsing review: '}
              {selected.data.__parse_review_note}
            </p>
          )}
          <dl className="space-y-2">
            {Object.entries(selected.data)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground text-xs">{k}</dt>
                  <dd className="break-words whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
          </dl>
          {selected.review_notes && <p>{selected.review_notes}</p>}
          {result.canReview && !onSelect && (
            <SourceReview
              key={`${selected.id}:${selected.review_version}`}
              record={selected}
              onSaved={() => {
                setSelected(null);
                setRefresh((n) => n + 1);
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
