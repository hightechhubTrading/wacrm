'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { QuotationDraft } from '@/lib/quotations/workspace';
import type {
  KnowledgeRecord,
  QuotationKnowledge,
} from '@/lib/quotations/knowledge/types';
import {
  calculatePrice,
  snapshot,
  stalePrice,
} from '@/lib/quotations/knowledge/calculations';
import { SourceBrowser } from './source-browser';
import { ShutterPilot } from './shutter-pilot';
export function QuotationKnowledgePanel({
  draft,
  onChange,
  disabled,
}: {
  draft: QuotationDraft;
  onChange: (d: QuotationDraft) => void;
  disabled: boolean;
}) {
  const ar = useLocale() === 'ar';
  const latest = useRef({ draft, disabled });
  useEffect(() => {
    latest.current = { draft, disabled };
  }, [draft, disabled]);
  const [applying, setApplying] = useState(false);
  const [itemId, setItemId] = useState('');
  const [tab, setTab] = useState('');
  const [error, setError] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [manual, setManual] = useState(false);
  const [fifthSheet, setFifth] = useState(false);
  const items = draft.items.filter(
    (i) => i.itemType === 'line' && !i.parentItemId && i.kind !== 'Service'
  );
  const item = items.find((i) => i.id === itemId) ?? items[0];
  const k: QuotationKnowledge = draft.documentDetails.knowledge ?? {
    prices: {},
    references: [],
  };
  const price = item ? k.prices[item.id] : undefined;
  function update(knowledge: QuotationKnowledge, nextItems = draft.items) {
    onChange({
      ...draft,
      items: nextItems,
      documentDetails: { ...draft.documentDetails, knowledge },
    });
  }
  async function select(r: KnowledgeRecord) {
    if (disabled || applying || !item) return;
    setApplying(true);
    setError('');
    try {
      if (r.kind === 'product') {
        const s = snapshot(r);
        if (!r.configuration.catalogItemId)
          throw Error(
            ar
              ? 'اربط المصدر بصنف في المخزون المشترك أولاً.'
              : 'Link this source to a shared inventory item first.'
          );
        const response = await fetch(
          '/api/catalog-items?id=' +
            encodeURIComponent(r.configuration.catalogItemId)
        );
        const rows = await response.json();
        if (
          latest.current.disabled ||
          JSON.stringify(latest.current.draft.items) !==
            JSON.stringify(draft.items)
        )
          throw Error(
            ar
              ? 'تغير العرض. اختر المنتج مرة أخرى.'
              : 'The quotation changed. Select the product again.'
          );
        const product =
          response.ok && Array.isArray(rows)
            ? rows.find((p) => p.id === r.configuration.catalogItemId)
            : null;
        if (!product)
          throw Error(
            ar
              ? 'اختر صنفاً محدداً ومجهزاً من الكتالوج لهذا المصدر.'
              : 'Select a specific prepared catalogue item for this source.'
          );
        const updatedItem = {
          ...item,
          productId: product.id,
          description: product.name,
          descriptionAr: product.name_ar ?? undefined,
          specification: product.description ?? undefined,
          unit: product.unit_of_measure ?? undefined,
          unitPrice: (product.default_unit_price ?? undefined) as
            number | undefined,
        };
        const prices = { ...k.prices };
        delete prices[item.id];
        if (r.configuration.pricing) {
          const result = calculatePrice(r, updatedItem, {
            manual: false,
            fifthSheet: false,
          });
          updatedItem.unit = result.unit;
          updatedItem.unitPrice = result.unitPrice;
          prices[item.id] = result.snapshot;
        }
        update(
          {
            ...k,
            prices,
            references: [
              ...k.references.filter((x) => x.recordId !== s.recordId),
              s,
            ],
          },
          draft.items.map((i) => (i.id === item.id ? updatedItem : i))
        );
      } else if (['price', 'grid'].includes(r.kind)) {
        if (
          r.configuration.catalogItemId &&
          item.productId !== r.configuration.catalogItemId
        )
          throw Error(
            ar
              ? 'هذا السعر مرتبط بمنتج آخر.'
              : 'This price belongs to a different catalog product.'
          );
        const result = calculatePrice(r, item, { manual, fifthSheet });
        update(
          { ...k, prices: { ...k.prices, [item.id]: result.snapshot } },
          draft.items.map((i) =>
            i.id === item.id
              ? { ...i, unit: result.unit, unitPrice: result.unitPrice }
              : i
          )
        );
      } else {
        const s = snapshot(r);
        update({
          ...k,
          references: [
            ...k.references.filter((x) => x.recordId !== s.recordId),
            s,
          ],
        });
      }
      setTab('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to apply source.');
    } finally {
      setApplying(false);
    }
  }
  return (
    <details className="mt-5 space-y-3 rounded-md border p-3">
      <summary className="cursor-pointer font-semibold">
        {ar
          ? 'المنتجات والأسعار المعتمدة وحساب المواد'
          : 'Reviewed products, pricing and material calculations'}
      </summary>
      <p className="text-muted-foreground text-sm">
        {ar
          ? 'استخدم معلومات المنتج الموثقة وقواعد التسعير المجهزة لهذا البند. يطبق الحساب التكوين المحدد.'
          : 'Use documented product facts and prepared pricing rules for this line. The calculation uses the selected configuration.'}{' '}
        <Link
          href="/quotations/knowledge"
          target="_blank"
          className="underline"
        >
          {ar ? 'مراجعة المصادر' : 'Review sources'}
        </Link>
        {' · '}
        <Link
          href={`/settings?tab=products${item?.productId ? `&product=${item.productId}` : ''}`}
          target="_blank"
          className="underline"
        >
          {ar ? 'المخزون المشترك للمنتجات' : 'Shared product inventory'}
        </Link>
      </p>
      {!item ? (
        <p>{ar ? 'أضف منتجاً أولاً.' : 'Add a product first.'}</p>
      ) : (
        <>
          <label className="block text-sm">
            {ar ? 'البند' : 'Quotation line'}
            <select
              className="bg-background ms-2 max-w-full rounded border p-2"
              value={item.id}
              onChange={(e) => {
                setItemId(e.target.value);
                setError('');
                setTab('');
              }}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode} · {i.description || i.descriptionAr || '—'}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              ['product', ar ? 'مواصفات المنتج' : 'Product preset'],
              ['price', ar ? 'سعر القائمة' : 'List price'],
              ['grid', ar ? 'شبكة أسعار المورد' : 'Supplier grid'],
              ['submittal', ar ? 'مرجع فني' : 'Technical reference'],
            ].map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                aria-pressed={tab === key}
                onClick={() => setTab(tab === key ? '' : key)}
              >
                {label}
              </Button>
            ))}
          </div>
          {['price', 'grid'].includes(tab) && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={fifthSheet}
                  onChange={(e) => setFifth(e.target.checked)}
                />{' '}
                {ar ? 'الشيت الخامس' : 'Fifth sheet'}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={manual}
                  onChange={(e) => setManual(e.target.checked)}
                />{' '}
                {ar ? 'تشغيل يدوي' : 'Manual operation'}
              </label>
              <p className="text-muted-foreground">
                {ar
                  ? 'لا تطبق الإضافات إلا إذا كانت قيمتها معتمدة في قاعدة السعر.'
                  : 'Adjustments apply only when explicitly approved in the price rule.'}
              </p>
            </div>
          )}
          {tab && (
            <SourceBrowser
              key={tab}
              kinds={[tab]}
              approvedOnly
              onSelect={select}
              disabled={disabled || applying}
            />
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {price && (
            <div className="space-y-2 rounded border p-2 text-sm">
              <strong>{price.label}</strong>
              <p className="text-xs break-all">
                {price.source}:{price.sourceRow} · v{price.reviewVersion} · QAR{' '}
                {price.appliedUnitPrice}/{price.appliedUnit}
              </p>
              {stalePrice(item, price) && (
                <p role="alert" className="text-destructive">
                  {ar
                    ? 'تغيرت الأبعاد أو السعر. أعد تطبيق القاعدة أو سجل السعر كتعديل يدوي قبل إصدار العرض.'
                    : 'Dimensions or pricing changed. Reapply the rule or record a manual override before issuing the quote.'}
                </p>
              )}
              <label className="block">
                {ar
                  ? 'سبب تعديل السعر يدوياً'
                  : 'Reason for manual price override'}
                <Input
                  value={overrideReason}
                  maxLength={2000}
                  disabled={disabled}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  disabled ||
                  !overrideReason.trim() ||
                  item.unitPrice === undefined
                }
                onClick={() => {
                  const prices = { ...k.prices };
                  delete prices[item.id];
                  update({
                    ...k,
                    prices,
                    manualOverrides: [
                      ...(k.manualOverrides ?? []),
                      {
                        itemId: item.id,
                        previous: price,
                        reason: overrideReason.trim(),
                        unitPrice: item.unitPrice ?? 0,
                        unit: item.unit ?? 'piece',
                        at: new Date().toISOString(),
                      },
                    ],
                  });
                  setOverrideReason('');
                }}
              >
                {ar
                  ? 'استخدام السعر كتعديل يدوي'
                  : 'Use current price as manual override'}
              </Button>
            </div>
          )}
          <ShutterPilot
            key={`${item.id}:${item.sizeW}:${item.sizeH}:${item.measurementUnit}:${item.qty}`}
            item={item}
            disabled={disabled}
            initial={k.costEstimates?.[item.id]}
            onSave={(estimate) =>
              update({
                ...k,
                costEstimates: { ...k.costEstimates, [item.id]: estimate },
              })
            }
          />
        </>
      )}
      {!!k.manualOverrides?.length && (
        <details className="border-t pt-2 text-sm">
          <summary>
            {ar ? 'سجل تعديلات الأسعار' : 'Manual price override history'}
          </summary>
          <ul>
            {k.manualOverrides.map((o, index) => (
              <li key={index} className="py-2">
                <p>
                  {items.find((i) => i.id === o.itemId)?.itemCode ?? o.itemId} ·
                  QAR {o.unitPrice}/{o.unit} · {o.at.slice(0, 10)}
                </p>
                <p>{o.reason}</p>
                <small>
                  {o.previous.source}:{o.previous.sourceRow} · v
                  {o.previous.reviewVersion}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!k.references.length && (
        <ul className="space-y-2 border-t pt-2 text-sm">
          {k.references.map((r) => (
            <li key={r.recordId} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-words">
                {r.label} · v{r.reviewVersion}
              </span>
              {r.configuration.commercial && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    const terms = r.configuration.commercial!;
                    const validity = new Date(
                      new Date().toLocaleDateString('en-CA', {
                        timeZone: 'Asia/Qatar',
                      }) + 'T12:00:00Z'
                    );
                    if (terms.validityDays)
                      validity.setUTCDate(
                        validity.getUTCDate() + terms.validityDays
                      );
                    onChange({
                      ...draft,
                      deliveryTerms: terms.deliveryTerms ?? draft.deliveryTerms,
                      paymentTerms: terms.paymentTerms ?? draft.paymentTerms,
                      warrantyTerms: terms.warrantyTerms ?? draft.warrantyTerms,
                      validUntil: terms.validityDays
                        ? validity.toISOString().slice(0, 10)
                        : draft.validUntil,
                      documentDetails: {
                        ...draft.documentDetails,
                        commercialPreset: undefined,
                        paymentSchedule: terms.paymentTerms
                          ? undefined
                          : draft.documentDetails.paymentSchedule,
                      },
                    });
                  }}
                >
                  {ar ? 'تطبيق الشروط المعتمدة' : 'Apply approved terms'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  update({
                    ...k,
                    references: k.references.filter(
                      (x) => x.recordId !== r.recordId
                    ),
                  })
                }
              >
                {ar ? 'إزالة' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
