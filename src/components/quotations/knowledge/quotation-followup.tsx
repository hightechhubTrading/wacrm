'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export function QuotationFollowup({ quotationId }: { quotationId: string }) {
  const ar = useLocale() === 'ar';
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    const c = new AbortController();
    fetch(`/api/quotations/${quotationId}/followup`, { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setVersion(b.version);
        setReason(b.reason);
        setDate(b.follow_up_date ?? '');
        setLoaded(true);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [open, loaded, quotationId]);
  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const r = await fetch(`/api/quotations/${quotationId}/followup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, reason, followUpDate: date || null }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setVersion(b.version);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="mx-4 my-3 rounded-md border p-3 text-sm"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">
        {ar
          ? 'متابعة العرض وسبب النتيجة'
          : 'Quotation follow-up and outcome reason'}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          {ar
            ? 'ملاحظات داخلية مستقلة عن ملف العرض الصادر.'
            : 'Internal sales notes, stored separately from issued quotation documents.'}
        </p>
        <label className="block">
          {ar
            ? 'سبب الخسارة أو التأجيل / ملاحظة متابعة'
            : 'Loss or postponement reason / follow-up note'}
          <textarea
            className="bg-background min-h-20 w-full rounded border p-2"
            maxLength={2000}
            value={reason}
            disabled={!loaded || busy}
            onChange={(e) => {
              setReason(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label className="block">
          {ar ? 'تاريخ المتابعة' : 'Follow-up date'}
          <Input
            type="date"
            value={date}
            disabled={!loaded || busy}
            onChange={(e) => {
              setDate(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {saved && <p role="status">{ar ? 'تم الحفظ' : 'Saved'}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!loaded || busy}
            onClick={() => void save()}
          >
            {ar ? 'حفظ المتابعة' : 'Save follow-up'}
          </Button>
          {error && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoaded(false);
                setOpen(false);
                setError('');
              }}
            >
              {ar ? 'إعادة التحميل' : 'Reload'}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
