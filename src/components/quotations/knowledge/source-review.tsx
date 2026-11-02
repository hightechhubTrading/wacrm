'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { knowledgeLabel } from '@/lib/quotations/knowledge/ui-copy';
import type {
  KnowledgeRecord,
  KnowledgeConfiguration,
} from '@/lib/quotations/knowledge/types';
export function SourceReview({
  record: r,
  onSaved,
}: {
  record: KnowledgeRecord;
  onSaved: () => void;
}) {
  const ar = useLocale() === 'ar';
  const [config, setConfig] = useState<KnowledgeConfiguration>(r.configuration);
  const [status, setStatus] = useState(r.review_status);
  const [notes, setNotes] = useState(r.review_notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogRows, setCatalogRows] = useState<
    { id: string; name: string }[]
  >([]);
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      fetch('/api/catalog-items?q=' + encodeURIComponent(catalogQuery), {
        signal: c.signal,
      })
        .then((r) => (r.ok ? r.json() : []))
        .then(setCatalogRows)
        .catch(() => {});
    }, 200);
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [catalogQuery]);
  const pricing = config.pricing;
  const supplier = config.supplierCost;
  const fields = (
    values: Record<string, unknown>,
    set: (key: string, value: string | number | undefined) => void,
    numeric: string[]
  ) =>
    Object.entries(values).map(([key, value]) => (
      <label key={key} className="min-w-36 flex-1 text-xs">
        {knowledgeLabel(key === 'price' ? 'purchasePrice' : key, ar)}
        <Input
          type={numeric.includes(key) ? 'number' : 'text'}
          step="any"
          value={String(value ?? '')}
          onChange={(e) =>
            set(
              key,
              numeric.includes(key)
                ? e.target.value === ''
                  ? undefined
                  : Number(e.target.value)
                : e.target.value
            )
          }
        />
      </label>
    ));
  async function save() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/quotations/knowledge/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: r.id,
          version: r.review_version,
          status,
          notes,
          configuration: config,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw Error(b.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t pt-3">
      <h3 className="font-semibold">
        {ar ? 'مراجعة مسؤول الحساب' : 'Account administrator review'}
      </h3>
      <p className="text-muted-foreground">
        {ar
          ? 'اعتمد فقط ما أكدته الشركة. اذكر مصدر التأكيد وأي حدود للتطبيق.'
          : 'Approve only confirmed rules. Record who confirmed them, the evidence and applicable limits.'}
      </p>
      <label className="block">
        {ar ? 'حالة المراجعة' : 'Review status'}
        <select
          className="bg-background ms-2 rounded border p-2"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          {['pending', 'approved', 'rejected'].map((s) => (
            <option key={s} value={s}>
              {knowledgeLabel(s, ar)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="min-w-36 flex-1 text-xs">
          {ar ? 'رمز عائلة المنتج' : 'Product family code'}
          <Input
            value={config.family ?? ''}
            onChange={(e) =>
              setConfig((c) => ({ ...c, family: e.target.value || undefined }))
            }
          />
        </label>
        <label className="min-w-36 flex-1 text-xs">
          {ar ? 'بحث في الكتالوج للربط' : 'Find catalog product to link'}
          <Input
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
          />
        </label>
        <label className="min-w-36 flex-1 text-xs">
          {ar ? 'المنتج المرتبط' : 'Linked catalog product'}
          <select
            className="bg-background h-9 w-full max-w-full rounded border px-2"
            value={config.catalogItemId ?? ''}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                catalogItemId: e.target.value || undefined,
              }))
            }
          >
            <option value="">{ar ? 'بدون ربط' : 'No linked product'}</option>
            {config.catalogItemId &&
              !catalogRows.some((r) => r.id === config.catalogItemId) && (
                <option value={config.catalogItemId}>
                  {ar ? 'المنتج المرتبط الحالي' : 'Currently linked product'}
                </option>
              )}
            {catalogRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {['price', 'grid', 'product'].includes(r.kind) && (
        <>
          <label className="block">
            {ar ? 'طريقة الحساب' : 'Pricing method'}
            <select
              className="bg-background ms-2 rounded border p-2"
              value={pricing?.basis ?? ''}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  pricing: e.target.value
                    ? {
                        basis: e.target.value as NonNullable<
                          KnowledgeConfiguration['pricing']
                        >['basis'],
                        rate: 0,
                        currency: 'QAR',
                        column: 'confirmed',
                      }
                    : undefined,
                }))
              }
            >
              <option value="">{ar ? 'اختر' : 'Choose'}</option>
              {['area', 'piece', 'width', 'width_band', 'grid'].map((s) => (
                <option key={s} value={s}>
                  {knowledgeLabel(s, ar)}
                </option>
              ))}
            </select>
          </label>
          {pricing && (
            <>
              <label>
                {ar ? 'عمود السعر المؤكد' : 'Confirmed price column'}
                <select
                  className="bg-background ms-2 rounded border p-2"
                  value={pricing.column ?? 'confirmed'}
                  onChange={(e) => {
                    const column = e.target.value as
                      'O' | 'P' | 'R' | 'S' | 'confirmed';
                    setConfig((c) => ({
                      ...c,
                      pricing: {
                        ...pricing,
                        column,
                        rate:
                          column === 'confirmed'
                            ? pricing.rate
                            : Number(r.data[`col_${column}`]) || 0,
                      },
                    }));
                  }}
                >
                  {['confirmed', 'O', 'P', 'R', 'S'].map((s) => (
                    <option
                      key={s}
                      value={s}
                      disabled={s !== 'confirmed' && !r.data[`col_${s}`]}
                    >
                      {s === 'confirmed'
                        ? ar
                          ? 'سعر مؤكد مباشرة'
                          : 'Directly confirmed rate'
                        : s}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {fields(
                  {
                    rate: pricing.rate,
                    minWidthCm: pricing.minWidthCm,
                    maxWidthCm: pricing.maxWidthCm,
                    minHeightCm: pricing.minHeightCm,
                    maxHeightCm: pricing.maxHeightCm,
                    minimumAreaM2: pricing.minimumAreaM2,
                    fifthSheetQar: pricing.fifthSheetQar,
                    manualAdjustmentQar: pricing.manualAdjustmentQar,
                  },
                  (k, v) =>
                    setConfig((c) => ({
                      ...c,
                      pricing: { ...pricing, [k]: v },
                    })),
                  [
                    'rate',
                    'minWidthCm',
                    'maxWidthCm',
                    'minHeightCm',
                    'maxHeightCm',
                    'minimumAreaM2',
                    'fifthSheetQar',
                    'manualAdjustmentQar',
                  ]
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {ar
                  ? 'الأسعار بالريال القطري والأبعاد بالسنتيمتر. حدود شبكة المورد يجب تأكيدها، ولا يتم الاستيفاء تلقائياً.'
                  : 'Rates are QAR; limits are cm. Confirm grid-cell limits explicitly; no interpolation is assumed.'}
              </p>
            </>
          )}
        </>
      )}
      {r.kind === 'product' && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setConfig((c) => ({
                ...c,
                commercial: c.commercial ? undefined : { validityDays: 10 },
              }))
            }
          >
            {ar
              ? 'إعداد شروط تجارية معتمدة'
              : 'Configure approved commercial terms'}
          </Button>
          {config.commercial && (
            <div className="flex flex-wrap gap-2">
              {fields(
                {
                  deliveryTerms: config.commercial.deliveryTerms ?? '',
                  paymentTerms: config.commercial.paymentTerms ?? '',
                  warrantyTerms: config.commercial.warrantyTerms ?? '',
                  validityDays: config.commercial.validityDays,
                },
                (key, value) =>
                  setConfig((c) => ({
                    ...c,
                    commercial: { ...c.commercial, [key]: value || undefined },
                  })),
                ['validityDays']
              )}
            </div>
          )}
        </div>
      )}
      {r.kind === 'supplier' && (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setConfig((c) => ({
                ...c,
                supplierCost: c.supplierCost
                  ? undefined
                  : {
                      itemId: '',
                      currency: '',
                      price: 0,
                      unit: 'm',
                      metresPerPricedUnit: 1,
                      fxToQar: 0,
                      freightQarPerUnit: 0,
                      dutyQarPerUnit: 0,
                      clearingQarPerUnit: 0,
                      effectiveDate: '',
                    },
              }))
            }
          >
            {ar ? 'تكلفة التوريد الواصلة' : 'Configure landed supplier cost'}
          </Button>
          {supplier && (
            <>
              <label>
                {ar ? 'وحدة التكلفة بعد التحويل' : 'Normalized cost unit'}
                <select
                  className="bg-background ms-2 rounded border p-2"
                  value={supplier.unit}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      supplierCost: {
                        ...supplier,
                        unit: e.target.value as typeof supplier.unit,
                      },
                    }))
                  }
                >
                  {['m', 'piece', 'pair', 'set'].map((s) => (
                    <option key={s} value={s}>
                      {knowledgeLabel(s, ar)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {fields(
                  Object.fromEntries(
                    Object.entries(supplier).filter(([key]) => key !== 'unit')
                  ),
                  (k, v) =>
                    setConfig((c) => ({
                      ...c,
                      supplierCost: { ...supplier, [k]: v },
                    })),
                  [
                    'price',
                    'metresPerPricedUnit',
                    'fxToQar',
                    'freightQarPerUnit',
                    'dutyQarPerUnit',
                    'clearingQarPerUnit',
                  ]
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {ar
                  ? 'الشحن والجمارك والتخليص بالريال لكل وحدة شراء. سجل التأكيد حتى إذا كانت التكلفة صفراً.'
                  : 'Freight, duty and clearing are QAR per purchased unit. Confirm every charge, including zero charges.'}
              </p>
            </>
          )}
        </>
      )}
      <label className="block">
        {ar ? 'ملاحظات التأكيد' : 'Confirmation notes'}
        <textarea
          className="bg-background min-h-24 w-full rounded border p-2"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        disabled={busy || !notes.trim()}
        onClick={() => void save()}
      >
        {busy ? '…' : ar ? 'حفظ المراجعة' : 'Save review'}
      </Button>
    </div>
  );
}
