'use client';
import './product-workspace.css';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Plus,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  BookOpen,
  ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { changeComponentKind } from '@/lib/quotations/company-presets';
import { CataloguePicker } from './catalogue-picker';
import {
  catalogueItem,
  cataloguePriceRows,
  catalogueTerms,
  type CatalogueProduct,
  type CatalogueTerms,
} from '@/lib/quotations/catalogue';
import {
  productProfile,
  productItemReference,
  type ItemOptions,
} from '@/lib/quotations/product-profile';
import { nextItemCode, convertDimensions } from '@/lib/quotations/item-editor';
import {
  computeQuotationTotals,
  areaPerItem,
  billableQuantity,
  isNonChargeable,
} from '@/lib/quotations/totals';
import type { QuotationItemToSave } from '@/lib/quotations/crud';
import type { QuotationKnowledge } from '@/lib/quotations/knowledge/types';
export function WorkspaceItems({
  items,
  onChange,
  disabled,
  currency,
  onCatalogueCapture,
  itemOptions = {},
  onOptionsChange,
  onTools,
}: {
  items: QuotationItemToSave[];
  onChange: (items: QuotationItemToSave[]) => void;
  disabled: boolean;
  currency: string;
  onCatalogueCapture?: (
    knowledge: QuotationKnowledge | undefined,
    terms: CatalogueTerms | undefined,
    itemId: string,
    resetPricing?: boolean
  ) => void;
  itemOptions?: Record<string, ItemOptions>;
  onOptionsChange?: (v: Record<string, ItemOptions>) => void;
  onTools?: (id: string) => void;
}) {
  const t = useTranslations('QuotationWorkspace'),
    ar = useLocale() === 'ar',
    l = (en: string, a: string) => (ar ? a : en);
  const [selectedId, setSelectedId] = useState<string | null>(
      items.find((i) => i.itemType === 'line' && !i.parentItemId)?.id ?? null
    ),
    [mobileEditor, setMobileEditor] = useState(
      items.filter((i) => i.itemType === 'line' && !i.parentItemId).length === 1
    ),
    [products, setProducts] = useState<CatalogueProduct[]>([]),
    [target, setTarget] = useState<{
      item?: QuotationItemToSave;
      parent?: QuotationItemToSave;
    } | null>(null),
    [undo, setUndo] = useState<QuotationItemToSave[] | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/quotations/catalogue', { signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b && !c.signal.aborted) setProducts(b.items);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  const roots = items.filter((i) => !i.parentItemId),
    selected =
      items.find((i) => i.id === selectedId && !i.parentItemId) ??
      roots.find((i) => i.itemType === 'line'),
    children = items.filter((i) => i.parentItemId === selected?.id),
    product = products.find((p) => p.id === selected?.productId),
    profile = product ? productProfile(product) : undefined,
    totals = computeQuotationTotals(items),
    money = (n: number) =>
      new Intl.NumberFormat(ar ? 'ar-QA' : 'en-QA', {
        style: 'currency',
        currency,
      }).format(n);
  function patch(id: string, values: Partial<QuotationItemToSave>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...values } : i)));
  }
  function remove(id: string) {
    setUndo(items);
    onChange(items.filter((i) => i.id !== id && i.parentItemId !== id));
  }
  function duplicate(item: QuotationItemToSave) {
    const id = crypto.randomUUID(),
      p = products.find((p) => p.id === item.productId),
      copy = {
        ...item,
        id,
        itemCode: p
          ? productItemReference(p, items)
          : nextItemCode(items, item.itemCode?.replace(/\d+$/, '') || 'ITEM'),
      };
    const additions = [
      copy,
      ...items
        .filter((i) => i.parentItemId === item.id)
        .map((c, index) => ({
          ...c,
          id: crypto.randomUUID(),
          parentItemId: id,
          itemCode: nextItemCode(items, 'ACC') + '-' + (index + 1),
        })),
    ];
    onChange([...items, ...additions]);
    if (itemOptions[item.id])
      onOptionsChange?.({
        ...itemOptions,
        [id]: structuredClone(itemOptions[item.id]),
      });
    setSelectedId(id);
  }
  function move(item: QuotationItemToSave, delta: number) {
    const index = roots.findIndex((i) => i.id === item.id),
      other = roots[index + delta];
    if (!other) return;
    const order = [...roots];
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    onChange(
      order.flatMap((r) => [r, ...items.filter((i) => i.parentItemId === r.id)])
    );
  }
  function option(key: string, value: string) {
    if (!selected) return;
    const current = itemOptions[selected.id] ?? {};
    onOptionsChange?.({
      ...itemOptions,
      [selected.id]:
        key === 'drawingReference'
          ? { ...current, drawingReference: value }
          : {
              ...current,
              selections: {
                ...current.selections,
                [key]: value,
                ...(key === 'finish' && value !== 'Custom'
                  ? { customFinish: '' }
                  : {}),
                ...(key === 'finish' &&
                (product?.deliveryPeriod || product?.customDeliveryPeriod)
                  ? {
                      deliveryPeriod:
                        value === 'Custom'
                          ? (product.customDeliveryPeriod ??
                            product.deliveryPeriod)
                          : product.deliveryPeriod,
                    }
                  : {}),
              },
            },
    });
  }
  function custom(section = false) {
    const item: QuotationItemToSave = {
      id: crypto.randomUUID(),
      itemType: section ? 'section' : 'line',
      itemCode: section ? undefined : nextItemCode(items, 'ITEM'),
      description: '',
      qty: 1,
      unit: section ? undefined : 'piece',
      measurementUnit: 'cm',
    };
    onChange([...items, item]);
    setSelectedId(item.id);
    setMobileEditor(true);
  }
  const numeric = (
    item: QuotationItemToSave,
    key: 'qty' | 'unitPrice' | 'sizeW' | 'sizeH' | 'discountValue',
    label: string,
    min = 0
  ) => (
    <label>
      {label}
      <Input
        aria-label={label}
        type="number"
        min={min}
        step="any"
        value={item[key] ?? ''}
        disabled={disabled}
        onChange={(e) =>
          patch(item.id, {
            [key]: e.target.value === '' ? undefined : Number(e.target.value),
          })
        }
      />
    </label>
  );
  const missing = (i: QuotationItemToSave) =>
    !isNonChargeable(i) &&
    (i.unitPrice === undefined ||
      !i.unit ||
      (i.unit === 'm2' && (!i.sizeW || !i.sizeH)));
  return (
    <div className={`qp-items ${mobileEditor ? 'qp-editing' : ''}`}>
      <aside
        className="qp-item-list"
        aria-label={l('Quotation items', 'بنود عرض السعر')}
      >
        <div className="qp-list-heading">
          <strong>
            {l('Items', 'البنود')}{' '}
            <small>{roots.filter((i) => i.itemType === 'line').length}</small>
          </strong>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => setTarget({})}
          >
            <Plus size={15} />
            {l('Add item', 'إضافة بند')}
          </Button>
        </div>
        <div className="qp-item-rows">
          {roots.map((item) =>
            item.itemType === 'section' ? (
              <button
                type="button"
                className="qp-list-section"
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setMobileEditor(true);
                }}
              >
                {item.description || l('Section', 'قسم')}
              </button>
            ) : (
              <button
                key={item.id}
                type="button"
                className="qp-item-row"
                aria-pressed={selected?.id === item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setMobileEditor(true);
                }}
              >
                <span className="qp-row-code" dir="ltr">
                  {item.itemCode || '—'}
                </span>
                <strong dir="auto">
                  {ar && item.descriptionAr
                    ? item.descriptionAr
                    : item.description || l('Custom item', 'بند مخصص')}
                </strong>
                <small>
                  {item.qty ?? 1} ×{' '}
                  {item.unit ?? l('Choose unit', 'حدد الوحدة')}
                  {items.some((i) => i.parentItemId === item.id)
                    ? ' · ' + l('With equipment', 'مع المعدات')
                    : ''}
                </small>
                <span
                  className={missing(item) ? 'qp-incomplete' : 'qp-row-total'}
                >
                  {missing(item)
                    ? l('Needs pricing', 'يحتاج إلى تسعير')
                    : money(
                        (totals.itemTotals[item.id] ?? 0) +
                          items
                            .filter((i) => i.parentItemId === item.id)
                            .reduce(
                              (n, i) => n + (totals.itemTotals[i.id] ?? 0),
                              0
                            )
                      )}
                </span>
              </button>
            )
          )}
        </div>
        {!roots.length && (
          <p className="qp-empty-list">
            {l(
              'Add a product or service to start your quotation.',
              'أضف منتجاً أو خدمة لبدء عرض السعر.'
            )}
          </p>
        )}
        <details className="qp-list-more">
          <summary>{l('Other item actions', 'إجراءات أخرى للبنود')}</summary>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => custom()}
          >
            {l('Custom item', 'بند مخصص')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => custom(true)}
          >
            {l('Section heading', 'عنوان قسم')}
          </Button>
          {undo && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onChange(undo);
                setUndo(null);
              }}
            >
              {l('Undo removal', 'تراجع عن الحذف')}
            </Button>
          )}
        </details>
      </aside>
      <div className="qp-item-editor">
        {!selected ? (
          <div className="qp-editor-empty">
            <BookOpen size={28} />
            <h3>
              {l(
                'Build the offer around the product',
                'ابدأ العرض باختيار المنتج'
              )}
            </h3>
            <p>
              {l(
                'Choose an item from the catalogue. Its units, specifications and applicable options appear here.',
                'اختر بنداً من الكتالوج لعرض وحداته ومواصفاته وخياراته هنا.'
              )}
            </p>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setTarget({})}
            >
              {l('Choose a product', 'اختيار منتج')}
            </Button>
          </div>
        ) : (
          <>
            <Button
              className="qp-back-items"
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMobileEditor(false)}
            >
              <ChevronLeft size={14} />
              {l('All items', 'كل البنود')}
            </Button>
            <div className="qp-editor-heading">
              <div>
                <span className="qp-eyebrow">
                  {selected.itemCode} {product?.sku ? ' · ' + product.sku : ''}
                </span>
                <h3 dir="auto">
                  {selected.description || l('Custom item', 'بند مخصص')}
                </h3>
                <p>
                  {product?.familyName ?? l('Quotation item', 'بند عرض السعر')}
                </p>
              </div>
              <div className="qp-editor-actions">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('duplicateProduct')}
                  disabled={disabled}
                  onClick={() => duplicate(selected)}
                >
                  <Copy size={16} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('deleteProduct')}
                  disabled={disabled}
                  onClick={() => remove(selected.id)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
            {selected.itemType === 'section' ? (
              <label>
                {t('sectionName')}
                <Input
                  value={selected.description ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    patch(selected.id, { description: e.target.value })
                  }
                />
              </label>
            ) : (
              <>
                <section className="qp-editor-block">
                  <div className="qp-section-heading">
                    <h4>{l('Configuration', 'التكوين')}</h4>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => setTarget({ item: selected })}
                    >
                      {l('Change product', 'تغيير المنتج')}
                    </Button>
                  </div>
                  <div className="qp-field-grid">
                    {numeric(
                      selected,
                      'qty',
                      selected.unit === 'm2'
                        ? l('Number of openings', 'عدد الفتحات')
                        : selected.unit === 'm'
                          ? l('Chargeable length (m)', 'الطول المحتسب (م)')
                          : selected.unit === 'job'
                            ? l('Number of jobs', 'عدد الأعمال')
                            : t('quantity')
                    )}
                    <label>
                      {l('Drawing / opening reference', 'مرجع المخطط / الفتحة')}
                      <Input
                        value={itemOptions[selected.id]?.drawingReference ?? ''}
                        placeholder={l('e.g. W-01', 'مثال: W-01')}
                        disabled={disabled}
                        onChange={(e) =>
                          option('drawingReference', e.target.value)
                        }
                      />
                    </label>
                    {profile?.fields.map((f) => (
                      <label key={f.key}>
                        {ar ? f.ar : f.en}
                        {f.options ? (
                          <select
                            aria-label={ar ? f.ar : f.en}
                            disabled={disabled}
                            value={
                              itemOptions[selected.id]?.selections?.[f.key] ??
                              ''
                            }
                            onChange={(e) => option(f.key, e.target.value)}
                          >
                            <option value="">{l('Select', 'اختر')}</option>
                            {f.options.map((o) => (
                              <option key={o} value={o}>
                                {ar
                                  ? ({
                                      White: 'أبيض',
                                      Beige: 'بيج',
                                      Custom: 'لون مخصص',
                                    }[o] ?? o)
                                  : o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            disabled={disabled}
                            value={
                              itemOptions[selected.id]?.selections?.[f.key] ??
                              ''
                            }
                            onChange={(e) => option(f.key, e.target.value)}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  {itemOptions[selected.id]?.selections?.finish ===
                    'Custom' && (
                    <label>
                      {l('Custom colour / finish', 'اللون / التشطيب المخصص')}
                      <Input
                        disabled={disabled}
                        value={
                          itemOptions[selected.id]?.selections?.customFinish ??
                          ''
                        }
                        onChange={(e) => option('customFinish', e.target.value)}
                      />
                      {product?.customDeliveryPeriod && (
                        <span className="qp-subtle">
                          {l(
                            'Recorded delivery for custom colours: ',
                            'مدة التسليم المسجلة للألوان المخصصة: '
                          ) + product.customDeliveryPeriod}
                        </span>
                      )}
                    </label>
                  )}
                  {(selected.unit === 'm2' ||
                    selected.sizeW !== undefined ||
                    selected.sizeH !== undefined ||
                    product?.inventory_type === 'product') && (
                    <div className="qp-dimensions">
                      {numeric(selected, 'sizeW', t('width'))}
                      <span aria-hidden>×</span>
                      {numeric(selected, 'sizeH', t('height'))}
                      <label>
                        {t('measurementUnit')}
                        <select
                          aria-label={t('measurementUnit')}
                          value={selected.measurementUnit ?? 'cm'}
                          disabled={disabled}
                          onChange={(e) =>
                            patch(
                              selected.id,
                              convertDimensions(selected, e.target.value)
                            )
                          }
                        >
                          {['mm', 'cm', 'm'].map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {selected.unit === 'm2' &&
                    !!selected.sizeW &&
                    !!selected.sizeH && (
                      <p className="qp-area" dir="auto">
                        {areaPerItem(selected).toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{' '}
                        m² × {selected.qty ?? 1} ={' '}
                        <strong>
                          {billableQuantity(selected).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 4 }
                          )}{' '}
                          m²
                        </strong>
                      </p>
                    )}
                </section>
                <section className="qp-editor-block">
                  <div className="qp-section-heading">
                    <h4>{l('Price', 'السعر')}</h4>
                    {onTools && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onTools(selected.id)}
                      >
                        {l('Sources & costing', 'المصادر والتكلفة')}
                      </Button>
                    )}
                  </div>
                  {product && cataloguePriceRows(product).length > 0 && (
                    <label>
                      {l('Recorded selling rates', 'أسعار البيع المسجلة')}
                      <select
                        aria-label={l(
                          'Recorded selling rates',
                          'أسعار البيع المسجلة'
                        )}
                        disabled={disabled}
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const [recordId, column] = e.target.value.split(':');
                          try {
                            const built = catalogueItem(
                              product,
                              selected.id,
                              selected.itemCode ??
                                productItemReference(product, items),
                              { recordId, column: column as 'O' },
                              currency
                            );
                            patch(selected.id, {
                              unit: built.item.unit,
                              unitPrice: built.item.unitPrice,
                            });
                            onCatalogueCapture?.(
                              built.knowledge,
                              undefined,
                              selected.id,
                              true
                            );
                          } catch (error) {
                            window.alert(
                              error instanceof Error
                                ? error.message
                                : String(error)
                            );
                          }
                        }}
                      >
                        <option value="">
                          {l(
                            'Choose a recorded rate or enter your own below',
                            'اختر سعراً مسجلاً أو أدخل السعر أدناه'
                          )}
                        </option>
                        {cataloguePriceRows(product).flatMap((r) =>
                          ['O', 'P', 'R', 'S']
                            .filter((c) => r.data['col_' + c])
                            .map((c) => (
                              <option
                                key={r.id + ':' + c}
                                value={r.id + ':' + c}
                              >
                                {r.data.item_en} · {c}: {r.data['col_' + c]} QAR
                                / {r.data.unit.replace(/^per /, '')}
                              </option>
                            ))
                        )}
                      </select>
                    </label>
                  )}
                  <div className="qp-price-grid">
                    <label>
                      {t('pricingMethod')}
                      <select
                        aria-label={t('pricingMethod')}
                        value={selected.unit ?? ''}
                        disabled={disabled}
                        onChange={(e) =>
                          patch(selected.id, {
                            unit: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">
                          {l('Choose pricing unit', 'حدد وحدة التسعير')}
                        </option>
                        {Array.from(
                          new Set(
                            [
                              'm2',
                              'piece',
                              'm',
                              'job',
                              'set',
                              'pair',
                              selected.unit,
                            ].filter(Boolean)
                          )
                        ).map((u) => (
                          <option key={u} value={u}>
                            {t.has('unit_' + u) ? t('unit_' + u) : u}
                          </option>
                        ))}
                      </select>
                    </label>
                    {numeric(
                      selected,
                      'unitPrice',
                      selected.unit === 'm2'
                        ? l('Rate per m²', 'سعر المتر المربع')
                        : l('Unit rate', 'سعر الوحدة')
                    )}
                    <div className="qp-line-total">
                      <small>{l('Item total', 'إجمالي البند')}</small>
                      <strong>
                        {missing(selected)
                          ? '—'
                          : money(totals.itemTotals[selected.id] ?? 0)}
                      </strong>
                    </div>
                  </div>
                  {missing(selected) && (
                    <p className="qp-incomplete" role="status">
                      {l(
                        'Complete the pricing unit, rate and required dimensions before issuing.',
                        'أكمل وحدة التسعير والسعر والأبعاد المطلوبة قبل إصدار العرض.'
                      )}
                    </p>
                  )}
                  <details className="qp-secondary">
                    <summary>{t('itemDiscount')}</summary>
                    <div className="qp-field-grid">
                      <label>
                        {t('discountType')}
                        <select
                          disabled={disabled}
                          value={selected.discountType ?? 'percent'}
                          onChange={(e) =>
                            patch(selected.id, {
                              discountType: e.target.value as
                                'percent' | 'fixed',
                            })
                          }
                        >
                          <option value="percent">%</option>
                          <option value="fixed">{currency}</option>
                        </select>
                      </label>
                      {numeric(selected, 'discountValue', t('discount'))}
                    </div>
                  </details>
                </section>
                <section className="qp-editor-block">
                  <div className="qp-section-heading">
                    <h4>{l('Equipment & extras', 'المعدات والإضافات')}</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setTarget({ parent: selected })}
                    >
                      <Plus size={14} />
                      {l('Add equipment', 'إضافة معدات')}
                    </Button>
                  </div>
                  {!children.length && (
                    <p className="qp-subtle">
                      {l(
                        'Add the motor, controls or accessories required for this configuration.',
                        'أضف المحرك أو وحدات التحكم أو الملحقات المطلوبة لهذا التكوين.'
                      )}
                    </p>
                  )}
                  {children.map((child) => (
                    <div className="qp-equipment-row" key={child.id}>
                      <div>
                        <strong dir="auto">{child.description}</strong>
                        <small>{child.itemCode}</small>
                      </div>
                      <label>
                        <span className="sr-only">
                          {l('Equipment charge', 'احتساب المعدات')}
                        </span>
                        <select
                          value={child.kind ?? 'Accessory'}
                          disabled={disabled}
                          aria-label={
                            l('Equipment charge', 'احتساب المعدات') +
                            ' ' +
                            child.itemCode
                          }
                          onChange={(e) => {
                            patch(
                              child.id,
                              changeComponentKind(
                                child,
                                selected,
                                e.target.value as
                                  'Included' | 'Accessory' | 'Optional'
                              )
                            );
                            onCatalogueCapture?.(
                              undefined,
                              undefined,
                              child.id,
                              true
                            );
                          }}
                        >
                          <option value="Included">
                            {l('Included', 'مشمول')}
                          </option>
                          <option value="Accessory">
                            {l('Additional charge', 'تكلفة إضافية')}
                          </option>
                          <option value="Optional">
                            {l('Optional', 'اختياري')}
                          </option>
                        </select>
                      </label>
                      {numeric(child, 'qty', t('quantity'))}
                      {child.kind !== 'Included' &&
                        numeric(child, 'unitPrice', l('Rate', 'السعر'))}
                      {child.kind !== 'Included' &&
                        products.find((p) => p.id === child.productId) && (
                          <label className="qp-equipment-rates">
                            <span>
                              {l(
                                'Recorded equipment rate',
                                'سعر المعدات المسجل'
                              )}
                            </span>
                            <select
                              aria-label={
                                l(
                                  'Recorded equipment rate',
                                  'سعر المعدات المسجل'
                                ) +
                                ' ' +
                                child.itemCode
                              }
                              value=""
                              disabled={disabled}
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const [recordId, column] =
                                    e.target.value.split(':'),
                                  p = products.find(
                                    (p) => p.id === child.productId
                                  )!;
                                const built = catalogueItem(
                                  p,
                                  child.id,
                                  child.itemCode ?? '',
                                  { recordId, column: column as 'O' },
                                  currency
                                );
                                patch(child.id, {
                                  unit: built.item.unit,
                                  unitPrice: built.item.unitPrice,
                                });
                                onCatalogueCapture?.(
                                  built.knowledge,
                                  undefined,
                                  child.id,
                                  true
                                );
                              }}
                            >
                              <option value="">
                                {l('Choose a rate', 'اختر سعراً')}
                              </option>
                              {cataloguePriceRows(
                                products.find((p) => p.id === child.productId)!
                              ).flatMap((r) =>
                                ['O', 'P', 'R', 'S']
                                  .filter(
                                    (c) =>
                                      r.data['col_' + c] &&
                                      Number.isFinite(
                                        Number(r.data['col_' + c])
                                      )
                                  )
                                  .map((c) => (
                                    <option
                                      key={r.id + c}
                                      value={r.id + ':' + c}
                                    >
                                      {c}: {r.data['col_' + c]} QAR ·{' '}
                                      {r.data.item_en}
                                    </option>
                                  ))
                              )}
                            </select>
                          </label>
                        )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('deleteAccessory')}
                        disabled={disabled}
                        onClick={() => remove(child.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </section>
                <details
                  className="qp-editor-block qp-description"
                  open={!selected.productId}
                >
                  <summary>{l('Quotation description', 'وصف العرض')}</summary>
                  <p className="qp-subtle">
                    {l(
                      'These details appear in the customer document.',
                      'تظهر هذه التفاصيل في مستند العميل.'
                    )}
                  </p>
                  <label>
                    {l('Selected specification', 'المواصفات المختارة')}
                    <textarea
                      rows={4}
                      value={selected.specification ?? ''}
                      disabled={disabled}
                      onChange={(e) =>
                        patch(selected.id, { specification: e.target.value })
                      }
                    />
                  </label>
                  <details className="qp-secondary">
                    <summary>
                      {l(
                        'Names, Arabic description & item reference',
                        'الأسماء والوصف العربي ومرجع البند'
                      )}
                    </summary>
                    <div className="qp-field-grid">
                      <label>
                        {t('productName')}
                        <Input
                          value={selected.description ?? ''}
                          disabled={disabled}
                          onChange={(e) =>
                            patch(selected.id, { description: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        {l('Arabic product name', 'اسم المنتج بالعربية')}
                        <Input
                          dir="rtl"
                          value={selected.descriptionAr ?? ''}
                          disabled={disabled}
                          onChange={(e) =>
                            patch(selected.id, {
                              descriptionAr: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {l('Quotation item reference', 'مرجع بند العرض')}
                        <Input
                          value={selected.itemCode ?? ''}
                          disabled={disabled}
                          onChange={(e) =>
                            patch(selected.id, { itemCode: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </details>
                </details>
              </>
            )}
            <div className="qp-editor-footer">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || roots.indexOf(selected) === 0}
                onClick={() => move(selected, -1)}
              >
                <ArrowUp size={14} />
                {l('Move up', 'نقل للأعلى')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={
                  disabled || roots.indexOf(selected) === roots.length - 1
                }
                onClick={() => move(selected, 1)}
              >
                <ArrowDown size={14} />
                {l('Move down', 'نقل للأسفل')}
              </Button>
            </div>
          </>
        )}
      </div>
      {target && (
        <CataloguePicker
          open
          onOpenChange={(v) => {
            if (!v) setTarget(null);
          }}
          creating={disabled}
          initialType={target.parent ? 'equipment' : 'product'}
          componentMode={!!target.parent}
          productCode={profile?.code}
          defaultApplyTerms={!roots.some((i) => i.itemType === 'line')}
          allowPrice
          onSelect={(p, selection) => {
            setProducts((current) =>
              current.some((x) => x.id === p.id)
                ? current.map((x) => (x.id === p.id ? p : x))
                : [...current, p]
            );
            const old = target.item,
              parent = target.parent,
              id = old?.id ?? crypto.randomUUID(),
              built = catalogueItem(
                p,
                id,
                old?.productId === p.id && old.itemCode
                  ? old.itemCode
                  : productItemReference(
                      p,
                      items.filter((i) => i.id !== id)
                    ),
                selection.price,
                currency
              );
            const line: QuotationItemToSave = {
              ...built.item,
              ...(old
                ? {
                    qty: old.qty,
                    sizeW: old.sizeW,
                    sizeH: old.sizeH,
                    measurementUnit: old.measurementUnit,
                    parentItemId: old.parentItemId,
                    kind: old.parentItemId ? old.kind : built.item.kind,
                    ...(old.productId === p.id && !selection.price
                      ? { unitPrice: old.unitPrice, unit: old.unit }
                      : {}),
                  }
                : {}),
              ...(parent
                ? {
                    parentItemId: parent.id,
                    kind: selection.componentKind ?? 'Accessory',
                    unit:
                      selection.componentKind === 'Included'
                        ? 'per_product'
                        : built.item.unit,
                    qty:
                      selection.componentKind === 'Included'
                        ? 1
                        : (parent.qty ?? 1),
                    unitPrice:
                      selection.componentKind === 'Included'
                        ? undefined
                        : built.item.unitPrice,
                  }
                : {}),
            };
            onChange(
              old
                ? items.map((i) => (i.id === id ? line : i))
                : [...items, line]
            );
            if (!parent && (!old || old.productId !== p.id))
              onOptionsChange?.({
                ...itemOptions,
                [id]: {
                  drawingReference: old
                    ? itemOptions[id]?.drawingReference
                    : undefined,
                  ...(p.deliveryPeriod
                    ? { selections: { deliveryPeriod: p.deliveryPeriod } }
                    : {}),
                },
              });
            onCatalogueCapture?.(
              parent && selection.componentKind === 'Included'
                ? undefined
                : built.knowledge,
              selection.applyTerms
                ? catalogueTerms(p, selection.paymentOption)
                : undefined,
              id,
              !old || old.productId !== p.id || !!selection.price
            );
            if (!parent) {
              setSelectedId(id);
              setMobileEditor(true);
            }
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}
