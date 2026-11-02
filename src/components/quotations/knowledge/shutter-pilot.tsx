'use client';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { computeQuotationTotals } from '@/lib/quotations/totals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { QuotationItemToSave } from '@/lib/quotations/crud';
import type {
  KnowledgeRecord,
  ShutterCostDraft,
} from '@/lib/quotations/knowledge/types';
import {
  shutter55Bom,
  landedUnitCost,
  estimateCost,
  recordLabel,
  snapshot,
  type BomLine,
} from '@/lib/quotations/knowledge/calculations';
import { knowledgeLabel } from '@/lib/quotations/knowledge/ui-copy';
import { SourceBrowser } from './source-browser';
function downloadCsv(
  rows: (string | number | null | undefined)[][],
  name: string
) {
  const text =
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              (typeof v === 'string' && /^[=+@\t\r-]/.test(v)
                ? "'" + v
                : String(v ?? '')
              ).replace(/"/g, '""') +
              '"'
          )
          .join(',')
      )
      .join('\r\n');
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ShutterPilot({
  item,
  disabled,
  initial,
  onSave,
}: {
  item: QuotationItemToSave;
  disabled: boolean;
  initial?: ShutterCostDraft;
  onSave: (estimate: ShutterCostDraft) => void;
}) {
  const ar = useLocale() === 'ar';
  const compatible =
    initial &&
    initial.width === item.sizeW &&
    initial.height === item.sizeH &&
    initial.measurementUnit === (item.measurementUnit ?? 'mm') &&
    initial.qty === (item.qty ?? 1);
  const saved = compatible ? initial : undefined;
  const [enabled, setEnabled] = useState(!!saved);
  const [automatic, setAutomatic] = useState(saved?.automatic ?? true);
  const [offers, setOffers] = useState<Record<string, KnowledgeRecord>>(() =>
    Object.fromEntries(
      Object.entries(saved?.offers ?? {}).map(([key, s]) => [
        key,
        {
          id: s.recordId,
          batch_id: s.batchId,
          record_key: s.source,
          kind: 'supplier',
          source: s.source,
          source_row: s.sourceRow,
          data: { item: s.label },
          review_status: 'approved',
          review_version: s.reviewVersion,
          review_notes: null,
          reviewed_at: s.reviewedAt,
          configuration: s.configuration,
        },
      ])
    )
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(
    saved?.quantities ?? {}
  );
  const [pick, setPick] = useState<BomLine | null>(null);
  const [error, setError] = useState('');
  const [extras, setExtras] = useState<{
    labour: number | null;
    installation: number | null;
    delivery: number | null;
    other: number | null;
  }>(
    saved?.extras ?? {
      labour: null,
      installation: null,
      delivery: null,
      other: null,
    }
  );
  let bom: ReturnType<typeof shutter55Bom> | undefined;
  let issue = '';
  if (enabled) {
    try {
      bom = shutter55Bom(item, automatic);
    } catch (e) {
      issue = e instanceof Error ? e.message : 'Invalid dimensions';
    }
  }
  const quantity = (line: BomLine) =>
    quantities[line.itemId] ??
    (line.confidence === 'source'
      ? line.quantity === null
        ? null
        : line.unit === 'piece' &&
            line.cutCm !== undefined &&
            offers[line.itemId]?.configuration.supplierCost?.unit === 'm'
          ? (line.quantity * line.cutCm) / 100
          : line.quantity
      : null);
  const rate = (line: BomLine) => {
    try {
      return offers[line.itemId] ? landedUnitCost(offers[line.itemId]) : null;
    } catch {
      return null;
    }
  };
  const estimate = estimateCost(
    bom?.lines.map((l) => ({ quantity: quantity(l), rate: rate(l) })) ?? [],
    extras,
    computeQuotationTotals([item]).total
  );
  return (
    <details className="space-y-3 border-t pt-3">
      <summary className="cursor-pointer text-sm font-medium">
        {ar
          ? 'تجربة قائمة قص شتر 55 مم وتقدير التكلفة'
          : '55 mm shutter cut-list pilot and cost estimate'}
      </summary>
      <p className="text-muted-foreground text-sm">
        {ar
          ? 'قواعد أولية من ملفات الطلبات؛ ليست اعتماداً هندسياً. افحص نظام 55 مم وبوكس 250 مم وأنبوب 60 مم. تقسيم Y/N والينابيع والمثبتات وسماكة الأنبوب واختيار المحرك تحتاج تأكيداً.'
          : 'Draft rules from order sheets; engineering approval is required. Check 55 mm slats, 250 mm box and Ø60 tube compatibility. The Y/N split, springs, fixings, tube thickness and motor selection remain unconfirmed.'}
      </p>
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />{' '}
        {ar
          ? 'حساب أولي لهذا النظام'
          : 'Calculate draft quantities for this system'}
      </label>
      {initial && !compatible && (
        <p className="text-warning text-sm">
          {ar
            ? 'التقدير المحفوظ يخص قياسات سابقة. أعد الحساب لهذه الأبعاد.'
            : 'The saved estimate uses previous dimensions. Recalculate for this opening.'}
        </p>
      )}
      {enabled && (
        <>
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => {
                setAutomatic(e.target.checked);
                setOffers({});
                setQuantities({});
              }}
            />{' '}
            {ar ? 'تشغيل آلي' : 'Automatic operation'}
          </label>
          {issue && (
            <p role="alert" className="text-destructive">
              {issue}
            </p>
          )}
          {bom && (
            <>
              <p className="text-sm">
                {bom.slatsPerShutter}{' '}
                {ar ? 'شريحة لكل شتر' : 'slats per shutter'} ·{' '}
                {bom.areaM2.toFixed(3)} m²
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr>
                      {[
                        ar ? 'المكون' : 'Component',
                        ar ? 'الكمية / القص' : 'Quantity / cut',
                        ar ? 'الدليل' : 'Evidence',
                        ar ? 'التكلفة' : 'Cost',
                      ].map((h) => (
                        <th key={h} className="p-2 text-start">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.lines.map((l) => (
                      <tr className="border-t" key={l.itemId}>
                        <td className="p-2">
                          {l.component}
                          <br />
                          <small>{l.itemId}</small>
                        </td>
                        <td className="p-2">
                          {l.quantity === null
                            ? 'TBC'
                            : Number(l.quantity.toFixed(3))}{' '}
                          {l.unit}
                          {l.cutCm !== undefined && (
                            <small className="block">
                              {l.cutCm.toFixed(2)} cm / cut
                            </small>
                          )}
                        </td>
                        <td className="p-2">
                          {knowledgeLabel(l.confidence, ar)}
                        </td>
                        <td className="min-w-40 space-y-1 p-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={disabled}
                            onClick={() =>
                              setPick(pick?.itemId === l.itemId ? null : l)
                            }
                          >
                            {offers[l.itemId]
                              ? recordLabel(offers[l.itemId])
                              : ar
                                ? 'اختيار تكلفة مؤكدة'
                                : 'Select confirmed cost'}
                          </Button>
                          {offers[l.itemId] && (
                            <>
                              <small className="block">
                                QAR {rate(l)?.toFixed(3)}/
                                {
                                  offers[l.itemId].configuration.supplierCost
                                    ?.unit
                                }
                              </small>
                              <label className="block">
                                {ar ? 'كمية للتكلفة' : 'Cost quantity'}
                                <Input
                                  aria-label={`Cost quantity ${l.itemId}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  disabled={disabled}
                                  value={quantity(l) ?? ''}
                                  onChange={(e) => {
                                    const next = { ...quantities };
                                    if (e.target.value === '')
                                      delete next[l.itemId];
                                    else
                                      next[l.itemId] = Math.max(
                                        0,
                                        Number(e.target.value)
                                      );
                                    setQuantities(next);
                                  }}
                                />
                              </label>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pick && (
                <SourceBrowser
                  kinds={['supplier']}
                  approvedOnly
                  onSelect={(r) => {
                    try {
                      const c = r.configuration.supplierCost;
                      if (!c || c.itemId !== pick.itemId)
                        throw Error(
                          ar
                            ? 'التكلفة تخص مكوناً آخر.'
                            : 'This offer is not mapped to this component.'
                        );
                      if (
                        c.unit !== pick.unit &&
                        !(c.unit === 'm' && pick.cutCm !== undefined)
                      )
                        throw Error(
                          'Normalize the supplier cost to the matching BOM unit.'
                        );
                      landedUnitCost(r);
                      setOffers((o) => ({ ...o, [pick.itemId]: r }));
                      setError('');
                      setPick(null);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Invalid cost');
                    }
                  }}
                />
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {Object.entries(extras).map(([k, v]) => (
                  <label key={k} className="min-w-28 flex-1 text-xs">
                    {knowledgeLabel(k === 'delivery' ? 'deliveryCost' : k, ar)}{' '}
                    · QAR
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={v ?? ''}
                      disabled={disabled}
                      onChange={(e) =>
                        setExtras((s) => ({
                          ...s,
                          [k]:
                            e.target.value === ''
                              ? null
                              : Math.max(0, Number(e.target.value)),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="text-sm">
                {ar ? 'مجموع التكاليف المدخلة' : 'Entered cost subtotal'}: QAR{' '}
                {estimate.partial.toFixed(2)} ·{' '}
                {estimate.complete
                  ? ar
                    ? 'تقدير مكتمل من المدخلات'
                    : 'Complete estimate from entered inputs'
                  : ar
                    ? 'تكاليف ناقصة؛ الربح غير متاح'
                    : 'Costs incomplete; margin unavailable'}
              </p>
              {estimate.complete && (
                <p className="text-sm">
                  {ar
                    ? 'هامش تقديري قبل خصم الطلب والمصاريف العامة'
                    : 'Estimated margin before order discounts and overheads'}
                  : QAR {estimate.marginQar?.toFixed(2)} (
                  {estimate.marginPercent?.toFixed(1)}%)
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                {ar
                  ? 'أكد كميات البنود المفترضة والناقصة يدوياً. الأسعار تخص مصادر معتمدة؛ تحقق من صلاحيتها الحالية.'
                  : 'Confirm assumed and missing quantities manually. Costs use approved offers; check their effective dates. These working calculations are exported separately from customer quotations.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    if (!bom) return;
                    onSave({
                      ruleVersion: '55mm-order-rules-v1',
                      width: item.sizeW!,
                      height: item.sizeH!,
                      measurementUnit: item.measurementUnit ?? 'mm',
                      qty: item.qty ?? 1,
                      automatic,
                      offers: Object.fromEntries(
                        Object.entries(offers).map(([key, r]) => [
                          key,
                          snapshot(r),
                        ])
                      ),
                      quantities,
                      extras,
                    });
                  }}
                >
                  {ar
                    ? 'حفظ التقدير في مسودة العرض'
                    : 'Keep estimate in quotation draft'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      [
                        [
                          'DRAFT — ENGINEERING REVIEW REQUIRED',
                          '55mm-order-rules-v1',
                          'Source: BOM-Window-Shutter.md',
                          `W=${item.sizeW} H=${item.sizeH} ${item.measurementUnit} qty=${item.qty} automatic=${automatic}`,
                          new Date().toISOString(),
                        ],
                        [
                          'Item',
                          'Component',
                          'Quantity',
                          'Unit',
                          'Cut cm per piece',
                          'Evidence',
                        ],
                        ...bom!.lines.map((l) => [
                          l.itemId,
                          l.component,
                          l.quantity,
                          l.unit,
                          l.cutCm,
                          l.confidence,
                        ]),
                      ],
                      `shutter55-${item.itemCode ?? 'draft'}.csv`
                    )
                  }
                >
                  {ar ? 'تصدير قائمة القص الأولية' : 'Export draft cut list'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      [
                        [
                          'INTERNAL ESTIMATE',
                          '55mm-order-rules-v1',
                          new Date().toISOString(),
                        ],
                        [
                          'Item',
                          'Component',
                          'Quantity',
                          'Unit',
                          'Landed unit cost QAR',
                          'Source',
                          'Review version',
                          'Effective date',
                        ],
                        ...bom!.lines.map((l) => [
                          l.itemId,
                          l.component,
                          quantity(l),
                          offers[l.itemId]?.configuration.supplierCost?.unit,
                          rate(l),
                          offers[l.itemId]?.source,
                          offers[l.itemId]?.review_version,
                          offers[l.itemId]?.configuration.supplierCost
                            ?.effectiveDate,
                        ]),
                        ...Object.entries(extras).map(([k, v]) => [
                          k,
                          '',
                          1,
                          'job',
                          v,
                        ]),
                        ['Entered cost subtotal QAR', estimate.partial],
                        ['Complete', String(estimate.complete)],
                        [
                          'Estimated margin QAR before order discounts/overheads',
                          estimate.marginQar,
                        ],
                        ['Estimated margin percent', estimate.marginPercent],
                      ],
                      `shutter55-cost-${item.itemCode ?? 'draft'}.csv`
                    )
                  }
                >
                  {ar
                    ? 'تصدير تقدير التكلفة الداخلي'
                    : 'Export internal cost estimate'}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
