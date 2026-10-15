'use client';

import { pricingTone, toneClasses } from '@/lib/ui-colors';
import { WorkspaceSelect } from './workspace-select';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
  MoreHorizontal,
  Ruler,
  PackagePlus,
} from 'lucide-react';
import {
  SPECIFICATION_PRESETS,
  applySpecificationPreset,
  changeComponentKind,
} from '@/lib/quotations/company-presets';
import type { QuotationItemToSave } from '@/lib/quotations/crud';
import {
  computeQuotationTotals,
  areaPerItem,
  billableQuantity,
} from '@/lib/quotations/totals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  PRODUCT_STARTERS,
  ACCESSORY_STARTERS,
  nextItemCode,
  convertDimensions,
} from '@/lib/quotations/item-editor';

function ProductDisclosure({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  return (
    <details className="qw-focused-product" open={open}>
      {children}
    </details>
  );
}

function ItemName({
  item,
  disabled,
  onChange,
  accessory = false,
}: {
  accessory?: boolean;
  item: QuotationItemToSave;
  disabled: boolean;
  onChange: (patch: Partial<QuotationItemToSave>) => void;
}) {
  const t = useTranslations('QuotationWorkspace');
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [results, setResults] = useState<
    {
      id: string;
      name: string;
      name_ar?: string;
      description?: string;
      default_unit_price: number | null;
      unit_of_measure?: string;
      sku?: string;
      category?: string;
    }[]
  >([]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/catalog-items?q=${encodeURIComponent(browse ? '' : (item.description ?? ''))}`,
        { signal: controller.signal }
      )
        .then((r) => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [item.description, open, browse]);
  return (
    <div
      className="qw-catalog"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Input
        aria-label={t(accessory ? 'accessoryName' : 'productName')}
        placeholder={t('productNamePlaceholder')}
        value={item.description ?? ''}
        disabled={disabled}
        onChange={(e) => {
          onChange({ description: e.target.value, productId: undefined });
          setResults([]);
          setBrowse(false);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      <button
        type="button"
        className="qw-library-button"
        disabled={disabled}
        onClick={() => {
          setBrowse(true);
          setOpen(true);
        }}
      >
        {t('browseCatalog')}
      </button>
      {item.productId && (
        <small className="qw-hint">{t('catalogLinked')}</small>
      )}
      {open && results.length > 0 && (
        <div className="qw-catalog-results">
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                onChange({
                  productId: row.id,
                  description: row.name,
                  descriptionAr: row.name_ar ?? item.descriptionAr,
                  specification: row.description ?? item.specification,
                  unit: row.unit_of_measure ?? item.unit,
                  unitPrice: row.default_unit_price ?? item.unitPrice,
                });
                setOpen(false);
              }}
            >
              <span>
                {row.name}
                <small>
                  {[row.sku, row.category, row.unit_of_measure]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <small>{row.default_unit_price?.toLocaleString() ?? '—'}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function WorkspaceItems({
  items,
  onChange,
  disabled,
  currency,
}: {
  items: QuotationItemToSave[];
  onChange: (items: QuotationItemToSave[]) => void;
  disabled: boolean;
  currency: string;
}) {
  const t = useTranslations('QuotationWorkspace');
  const locale = useLocale();
  const [undo, setUndo] = useState<{
    removed: QuotationItemToSave[];
    index: number;
  } | null>(null);
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [expandedAccessoryId, setExpandedAccessoryId] = useState<string | null>(
    null
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [discounts, setDiscounts] = useState<Set<string>>(new Set());
  const latestItems = useRef(items);
  useEffect(() => {
    latestItems.current = items;
  }, [items]);
  const totals = computeQuotationTotals(items);
  const roots = items.filter((i) => !i.parentItemId);
  const money = (n: number) =>
    n.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const patch = (id: string, value: Partial<QuotationItemToSave>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...value } : i)));
  const unitOptions = ['piece', 'm2', 'set', 'pair', 'job', 'm'];
  const unitLabel = (unit: string) =>
    t.has(`unit_${unit}`) ? t(`unit_${unit}`) : unit;
  function add(
    starter?: { en: string; ar: string; service?: boolean },
    parent?: QuotationItemToSave,
    itemType: 'line' | 'section' = 'line',
    componentKind: 'Included' | 'Accessory' | 'Optional' = 'Accessory'
  ) {
    const item: QuotationItemToSave = {
      id: crypto.randomUUID(),
      itemType,
      description: starter?.en ?? '',
      descriptionAr: starter?.ar ?? '',
      qty: parent && componentKind === 'Included' ? 1 : (parent?.qty ?? 1),
      unit:
        parent && componentKind === 'Included'
          ? 'per_product'
          : starter?.service
            ? 'job'
            : 'piece',
      measurementUnit: 'mm',
      parentItemId: parent?.id,
      kind: parent ? componentKind : starter?.service ? 'Service' : undefined,
      itemCode:
        itemType === 'section'
          ? undefined
          : nextItemCode(items, parent ? 'A' : starter?.service ? 'S' : 'D'),
    };
    if (!parent) setExpandedId(item.id);
    else setExpandedAccessoryId(item.id);
    if (parent) {
      const index = items.reduce(
        (n, i, index) =>
          i.id === parent.id || i.parentItemId === parent.id ? index + 1 : n,
        0
      );
      onChange([...items.slice(0, index), item, ...items.slice(index)]);
    } else onChange([...items, item]);
  }
  function remove(id: string) {
    setUndo({
      removed: items.filter((i) => i.id === id || i.parentItemId === id),
      index: items.findIndex((i) => i.id === id),
    });
    onChange(items.filter((i) => i.id !== id && i.parentItemId !== id));
  }
  function restore() {
    if (!undo) return;
    const restored = undo.removed.filter(
      (i) => !items.some((existing) => existing.id === i.id)
    );
    const index = Math.min(undo.index, items.length);
    onChange([...items.slice(0, index), ...restored, ...items.slice(index)]);
    setUndo(null);
  }
  function duplicate(item: QuotationItemToSave) {
    const id = crypto.randomUUID();
    const copied = {
      ...item,
      id,
      itemCode:
        item.itemType === 'section'
          ? undefined
          : nextItemCode(
              items,
              item.parentItemId ? 'A' : item.kind === 'Service' ? 'S' : 'D'
            ),
    };
    if (!item.parentItemId) setExpandedId(id);
    else setExpandedAccessoryId(id);
    const group = [copied];
    const working = [...items, copied];
    for (const child of items.filter((i) => i.parentItemId === item.id)) {
      const next = {
        ...child,
        id: crypto.randomUUID(),
        parentItemId: id,
        itemCode: nextItemCode(working, 'A'),
      };
      group.push(next);
      working.push(next);
    }
    const end = items.reduce(
      (n, i, index) =>
        i.id === item.id || i.parentItemId === item.id ? index + 1 : n,
      0
    );
    onChange([...items.slice(0, end), ...group, ...items.slice(end)]);
  }
  function move(id: string, delta: number) {
    const index = roots.findIndex((i) => i.id === id);
    if (index + delta < 0 || index + delta >= roots.length) return;
    const reordered = [...roots];
    [reordered[index], reordered[index + delta]] = [
      reordered[index + delta],
      reordered[index],
    ];
    onChange(
      reordered.flatMap((i) => [
        i,
        ...items.filter((c) => c.parentItemId === i.id),
      ])
    );
  }
  async function saveCatalog(item: QuotationItemToSave) {
    setCatalogBusy(item.id);
    setCatalogError(false);
    try {
      const res = await fetch('/api/catalog-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.description,
          category: item.parentItemId ? 'accessory' : 'product',
          nameAr: item.descriptionAr,
          description: item.specification,
          defaultUnitPrice: item.unitPrice,
          unitOfMeasure: item.unit,
        }),
      });
      if (!res.ok) throw new Error();
      const row = await res.json();
      onChange(
        latestItems.current.map((current) =>
          current.id === item.id ? { ...current, productId: row.id } : current
        )
      );
    } catch {
      setCatalogError(true);
    } finally {
      setCatalogBusy(null);
    }
  }
  function options(item: QuotationItemToSave, index: number, child: boolean) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={t('itemOptions')}
            />
          }
        >
          <MoreHorizontal size={17} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!child && (
            <>
              <DropdownMenuItem
                disabled={index === 0}
                onClick={() => move(item.id, -1)}
              >
                <ChevronUp size={15} />
                {t('moveUp')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === roots.length - 1}
                onClick={() => move(item.id, 1)}
              >
                <ChevronDown size={15} />
                {t('moveDown')}
              </DropdownMenuItem>
            </>
          )}
          {!item.productId && item.itemType === 'line' && (
            <DropdownMenuItem
              disabled={!item.description?.trim() || catalogBusy !== null}
              onClick={() => saveCatalog(item)}
            >
              {catalogBusy === item.id ? t('saving') : t('saveCatalog')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  function dimensions(item: QuotationItemToSave) {
    return (
      <fieldset className="qw-measurements">
        <legend>
          <Ruler size={15} />
          {t(item.unit === 'm2' ? 'areaDimensions' : 'openingDimensions')}
        </legend>
        <div className="qw-measurement-fields">
          <label>
            {t('width')}
            <div className="qw-measure-input">
              <Input
                type="number"
                min="0"
                step="any"
                aria-label={t('width')}
                placeholder={t('width')}
                value={item.sizeW ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  patch(item.id, {
                    sizeW:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
              <span>{item.measurementUnit ?? 'mm'}</span>
            </div>
          </label>
          <span aria-hidden className="qw-measure-times">
            ×
          </span>
          <label>
            {t('height')}
            <div className="qw-measure-input">
              <Input
                type="number"
                min="0"
                step="any"
                aria-label={t('height')}
                placeholder={t('height')}
                value={item.sizeH ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  patch(item.id, {
                    sizeH:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
              <span>{item.measurementUnit ?? 'mm'}</span>
            </div>
          </label>
          <label>
            {t('measurementUnit')}
            <WorkspaceSelect
              aria-label={t('measurementUnit')}
              disabled={disabled}
              value={item.measurementUnit ?? 'mm'}
              onValueChange={(value) =>
                patch(item.id, convertDimensions(item, value))
              }
            >
              {['mm', 'cm', 'm'].map((unit) => (
                <option key={unit} value={unit}>
                  {t(`dimension_${unit}`)}
                </option>
              ))}
            </WorkspaceSelect>
          </label>
        </div>
        <p>
          {t(
            item.unit === 'm2' ? 'areaDimensionsHint' : 'measurementPricingHint'
          )}
        </p>
      </fieldset>
    );
  }
  function pricing(item: QuotationItemToSave) {
    const unit = item.unit ?? 'piece';
    const hasPrice = item.unitPrice !== undefined;
    const discounted = !!item.discountValue;
    const optional = item.kind === 'Optional';
    const referenceTotal = optional
      ? computeQuotationTotals([{ ...item, kind: 'Accessory' }]).itemTotals[
          item.id
        ]
      : totals.itemTotals[item.id];
    return (
      <div className="qw-product-pricing">
        <div className="qw-price-fields">
          <label>
            {t(unit === 'm2' ? 'openingCount' : 'quantityFull')}
            <Input
              aria-label={t(unit === 'm2' ? 'openingCount' : 'quantityFull')}
              type="number"
              min="0.001"
              step="any"
              disabled={disabled}
              value={item.qty ?? ''}
              onChange={(e) =>
                patch(item.id, {
                  qty:
                    e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            {t('pricingMethod')}
            <WorkspaceSelect
              aria-label={t('pricingMethod')}
              disabled={disabled}
              value={unit}
              onValueChange={(value) => patch(item.id, { unit: value })}
            >
              {!unitOptions.includes(unit) && (
                <option value={unit}>{unitLabel(unit)}</option>
              )}
              {unitOptions.map((u) => (
                <option value={u} key={u} data-description={t(`unitHelp_${u}`)}>
                  {unitLabel(u)}
                </option>
              ))}
            </WorkspaceSelect>
          </label>
          <label>
            {t(optional ? 'optionalUnitPrice' : 'priceForUnit', {
              unit: unitLabel(unit),
              currency,
            })}
            <Input
              aria-label={t('unitPrice')}
              type="number"
              min="0"
              step="0.01"
              placeholder={t(optional ? 'priceOnRequest' : 'enterPrice')}
              value={item.unitPrice ?? ''}
              disabled={disabled}
              onChange={(e) =>
                patch(item.id, {
                  unitPrice:
                    e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <div className="qw-product-amount">
            <span>
              {t(
                optional
                  ? 'optionalReferenceTotal'
                  : item.parentItemId
                    ? 'itemTotal'
                    : 'baseProductTotal'
              )}
            </span>
            <strong>
              {hasPrice ? `${money(referenceTotal ?? 0)} ${currency}` : '—'}
            </strong>
          </div>
        </div>
        {unit === 'm2' && dimensions(item)}
        {unit === 'm2' && (
          <p className="qw-area-equation">
            {(item.sizeW ?? 0) > 0 && (item.sizeH ?? 0) > 0
              ? t('areaCalculation', {
                  area: areaPerItem(item).toLocaleString(locale, {
                    maximumFractionDigits: 6,
                  }),
                  qty: item.qty ?? 1,
                  totalArea: billableQuantity(item).toLocaleString(locale, {
                    maximumFractionDigits: 6,
                  }),
                  price: money(item.unitPrice ?? 0),
                  currency,
                })
              : t('areaDimensionsHint')}
          </p>
        )}
        <div className="qw-calculation">
          <span>
            {unit === 'm2'
              ? ''
              : hasPrice
                ? t('priceCalculation', {
                    qty: item.qty ?? 1,
                    unit: unitLabel(unit),
                    price: money(item.unitPrice!),
                    currency,
                  })
                : t(optional ? 'optionalPriceHint' : 'priceNeeded')}
            {discounted &&
              ` · ${t('discountApplied', { amount: money(billableQuantity(item) * (item.unitPrice ?? 0) - (totals.itemTotals[item.id] ?? 0)), currency })}`}
          </span>
          {!optional && !discounted && !discounts.has(item.id) && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDiscounts((prev) => new Set(prev).add(item.id))}
            >
              {t('addItemDiscount')}
            </button>
          )}
        </div>
        {(discounted || discounts.has(item.id)) && (
          <div className="qw-item-discount">
            <label>
              {t('itemDiscount')}
              <div className="qw-inline">
                <Input
                  aria-label={t('itemDiscount')}
                  type="number"
                  min="0"
                  step="any"
                  value={item.discountValue ?? 0}
                  disabled={disabled}
                  onChange={(e) =>
                    patch(item.id, {
                      discountType: item.discountType ?? 'percent',
                      discountValue: Number(e.target.value),
                    })
                  }
                />
                <WorkspaceSelect
                  aria-label={t('discountType')}
                  disabled={disabled}
                  value={item.discountType ?? 'percent'}
                  onValueChange={(value) =>
                    patch(item.id, {
                      discountType: value as 'fixed' | 'percent',
                    })
                  }
                >
                  <option value="percent">%</option>
                  <option value="fixed">{currency}</option>
                </WorkspaceSelect>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    patch(item.id, {
                      discountType: undefined,
                      discountValue: undefined,
                    });
                    setDiscounts((prev) => {
                      const next = new Set(prev);
                      next.delete(item.id);
                      return next;
                    });
                  }}
                >
                  {t('remove')}
                </button>
              </div>
            </label>
          </div>
        )}
      </div>
    );
  }
  function line(item: QuotationItemToSave, index: number, child = false) {
    const parent = items.find((i) => i.id === item.parentItemId);
    const codeLike = /^[A-Z]{1,3}\d{1,4}$/i.test(
      item.description?.trim() ?? ''
    );
    return (
      <div
        key={item.id}
        className={child ? 'qw-extra-line' : 'qw-product-line'}
        data-kind={item.kind}
      >
        {child && (
          <div className="qw-product-heading">
            {child && parent ? (
              <WorkspaceSelect
                className="qw-component-kind"
                aria-label={t('componentPricing')}
                value={
                  item.kind === 'Included'
                    ? 'Included'
                    : item.kind === 'Optional'
                      ? 'Optional'
                      : 'Accessory'
                }
                disabled={disabled}
                onValueChange={(value) =>
                  patch(
                    item.id,
                    changeComponentKind(
                      item,
                      parent,
                      value as 'Included' | 'Accessory' | 'Optional'
                    )
                  )
                }
              >
                <option
                  value="Included"
                  data-tone="success"
                  data-description={t('includedPricingHelp')}
                >
                  {t('includedComponent')}
                </option>
                <option
                  value="Accessory"
                  data-tone="info"
                  data-description={t('chargedPricingHelp')}
                >
                  {t('chargedComponent')}
                </option>
                <option
                  value="Optional"
                  data-tone="optional"
                  data-description={t('optionalPricingHelp')}
                >
                  {t('optionalComponent')}
                </option>
              </WorkspaceSelect>
            ) : (
              <strong>
                {child
                  ? t('extraItem')
                  : item.kind === 'Service'
                    ? t('serviceItem', { number: index + 1 })
                    : t('productItem', { number: index + 1 })}
              </strong>
            )}
            <label className="qw-code-field">
              <span>{t('drawingCode')}</span>
              <Input
                aria-label={t('itemCode')}
                placeholder="D01"
                value={item.itemCode ?? ''}
                disabled={disabled}
                onChange={(e) => patch(item.id, { itemCode: e.target.value })}
              />
            </label>
            {options(item, index, child)}
          </div>
        )}
        {child && (
          <p className="qw-component-explanation">
            {t(
              item.kind === 'Included'
                ? 'includedPricingHelp'
                : item.kind === 'Optional'
                  ? 'optionalPricingHelp'
                  : 'chargedPricingHelp'
            )}
          </p>
        )}
        <label className="qw-product-name">
          <span>{child ? t('accessoryName') : t('productName')}</span>
          <ItemName
            item={item}
            accessory={child}
            disabled={disabled}
            onChange={(value) =>
              patch(
                item.id,
                item.kind === 'Included'
                  ? { ...value, unit: 'per_product', unitPrice: undefined }
                  : value
              )
            }
          />
        </label>
        {codeLike && (
          <p className="qw-code-hint">
            {t('codeHint')}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                patch(item.id, { itemCode: item.description, description: '' })
              }
            >
              {t('useAsCode')}
            </button>
          </p>
        )}
        {item.kind === 'Included' ? (
          <div className="qw-included-component">
            <label>
              {t('includedQuantity')}
              <Input
                type="number"
                aria-label={t('includedQuantity')}
                min="0.001"
                step="any"
                value={item.qty ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  patch(item.id, {
                    qty:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
            <span>{t('includedPriceHint')}</span>
          </div>
        ) : (
          <>
            {pricing(item)}
            {item.kind === 'Optional' && (
              <div className="qw-optional-action">
                <span>{t('notInTotal')}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || item.unitPrice === undefined}
                  onClick={() => patch(item.id, { kind: 'Accessory' })}
                >
                  {t('acceptUpgrade')}
                </Button>
              </div>
            )}
          </>
        )}
        {!child && (
          <details className="qw-secondary-panel">
            <summary>{t('specificationsAndDimensions')}</summary>
            <label>
              {t('drawingCode')}
              <Input
                aria-label={t('itemCode')}
                placeholder="D01"
                value={item.itemCode ?? ''}
                disabled={disabled}
                onChange={(e) => patch(item.id, { itemCode: e.target.value })}
              />
            </label>
            {!child && item.kind !== 'Service' && (
              <div className="qw-specification-presets">
                <label>
                  {t('specificationTemplate')}
                  <WorkspaceSelect
                    aria-label={t('specificationTemplate')}
                    value=""
                    disabled={disabled}
                    onValueChange={(value) =>
                      onChange(applySpecificationPreset(items, item.id, value))
                    }
                  >
                    <option value="">{t('chooseSpecification')}</option>
                    {SPECIFICATION_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {t(preset.key)}
                      </option>
                    ))}
                  </WorkspaceSelect>
                </label>
                <p>{t('specificationReviewHint')}</p>
              </div>
            )}
            {!child && (
              <label className="qw-product-spec">
                <span>{t('materialsFinish')}</span>
                <textarea
                  rows={2}
                  dir="auto"
                  aria-label={t('materialsFinish')}
                  placeholder={t('specificationPlaceholder')}
                  disabled={disabled}
                  value={item.specification ?? ''}
                  onChange={(e) =>
                    patch(item.id, { specification: e.target.value })
                  }
                />
              </label>
            )}
            {!child &&
              item.kind !== 'Service' &&
              item.unit !== 'm2' &&
              dimensions(item)}
          </details>
        )}
        <details className="qw-details qw-language-details">
          <summary>{t('arabicAndNotes')}</summary>
          <label>
            {t('descriptionAr')}
            <Input
              aria-label={t('descriptionAr')}
              dir="rtl"
              placeholder={t('arabicNamePlaceholder')}
              disabled={disabled}
              value={item.descriptionAr ?? ''}
              onChange={(e) =>
                patch(item.id, { descriptionAr: e.target.value })
              }
            />
          </label>
          {child && (
            <label>
              {t('materialsFinish')}
              <Input
                aria-label={t('materialsFinish')}
                value={item.specification ?? ''}
                placeholder={t('specificationPlaceholder')}
                disabled={disabled}
                onChange={(e) =>
                  patch(item.id, { specification: e.target.value })
                }
              />
            </label>
          )}
        </details>
      </div>
    );
  }
  return (
    <div className="qw-company-items">
      <p className="qw-items-guide">{t('itemsGuide')}</p>
      {roots.length === 0 && (
        <div className="qw-empty">
          <strong>{t('companyItemsEmpty')}</strong>
          <p>{t('companyItemsEmptyHint')}</p>
        </div>
      )}
      {roots.map((item, index) => {
        const children = items.filter((i) => i.parentItemId === item.id);
        return (
          <div key={item.id} className="qw-product-group">
            {item.itemType === 'section' ? (
              <div className="qw-section-row">
                <Input
                  aria-label={t('sectionName')}
                  placeholder={t('sectionPlaceholder')}
                  value={item.description ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    patch(item.id, { description: e.target.value })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={t('duplicateSection')}
                  onClick={() => duplicate(item)}
                >
                  <Copy size={15} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={disabled}
                  className="ui-danger-action"
                  aria-label={t('deleteSection')}
                  onClick={() => remove(item.id)}
                >
                  <Trash2 size={15} />
                </Button>
                {options(item, index, false)}
              </div>
            ) : (
              <ProductDisclosure open={expandedId === item.id}>
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    setExpandedId(expandedId === item.id ? null : item.id);
                  }}
                >
                  <strong>
                    <ChevronDown
                      size={16}
                      className="qw-disclosure-icon"
                      aria-hidden
                    />
                    {item.kind ? `${item.kind} · ` : ''}
                    {item.description || t('productName')}
                  </strong>
                  <span>
                    {money(
                      (totals.itemTotals[item.id] ?? 0) +
                        children.reduce(
                          (sum, child) =>
                            sum + (totals.itemTotals[child.id] ?? 0),
                          0
                        )
                    )}{' '}
                    {currency}
                  </span>
                  <small>
                    {item.itemCode} ·{' '}
                    {t('summaryQuantity', { qty: item.qty ?? 1 })}
                    {item.unit === 'm2'
                      ? ` · ${billableQuantity(item).toLocaleString(locale, { maximumFractionDigits: 4 })} m²`
                      : ''}
                  </small>
                  <div
                    className="qw-visible-item-actions"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      className="text-info"
                      aria-label={t('duplicateProduct')}
                      onClick={() => duplicate(item)}
                    >
                      <Copy size={15} />
                      {t('duplicate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      className="ui-danger-action"
                      aria-label={t('deleteProduct')}
                      onClick={() => remove(item.id)}
                    >
                      <Trash2 size={15} />
                      {t('deleteShort')}
                    </Button>
                    {options(item, index, false)}
                  </div>
                </summary>
                {line(item, index)}
                <details className="qw-product-extras qw-secondary-panel">
                  <summary>
                    {t('accessoriesCount', { count: children.length })}
                  </summary>
                  <div className="qw-extras-heading">
                    <div>
                      <strong>
                        <PackagePlus size={16} />
                        {t('packageContents')}
                      </strong>
                      <p>{t('componentGuide')}</p>
                      <details className="qw-pricing-help">
                        <summary>{t('pricingHelpTitle')}</summary>
                        <p>{t('pricingExample')}</p>
                      </details>
                    </div>
                  </div>
                  <div className="qw-component-add-actions">
                    {(['Included', 'Accessory', 'Optional'] as const).map(
                      (kind) => (
                        <DropdownMenu key={kind}>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant={
                                  kind === 'Included' ? 'outline' : 'ghost'
                                }
                                size="sm"
                                disabled={disabled}
                              />
                            }
                          >
                            <Plus size={14} />
                            {t(
                              kind === 'Included'
                                ? 'addIncluded'
                                : kind === 'Optional'
                                  ? 'addOptional'
                                  : 'addCharged'
                            )}
                            <ChevronDown size={13} aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {(kind === 'Optional'
                              ? ACCESSORY_STARTERS.filter((s) =>
                                  ['lock', 'handle'].includes(s.key)
                                )
                              : ACCESSORY_STARTERS
                            ).map((starter) => (
                              <DropdownMenuItem
                                key={starter.key}
                                onClick={() => add(starter, item, 'line', kind)}
                              >
                                {t(starter.key)}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => add(undefined, item, 'line', kind)}
                            >
                              {t('customAccessory')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )
                    )}
                  </div>
                  {children.map((child) => (
                    <details
                      key={child.id}
                      className="qw-compact-accessory"
                      open={expandedAccessoryId === child.id}
                    >
                      <summary
                        onClick={(event) => {
                          event.preventDefault();
                          setExpandedAccessoryId(
                            expandedAccessoryId === child.id ? null : child.id
                          );
                        }}
                      >
                        <strong>
                          {child.description || t('accessoryName')}
                        </strong>
                        <span className={toneClasses(pricingTone(child.kind))}>
                          {t(
                            child.kind === 'Included'
                              ? 'includedShort'
                              : child.kind === 'Optional'
                                ? 'optionalShort'
                                : 'chargedShort'
                          )}
                        </span>
                        <div
                          className="qw-visible-item-actions"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={disabled}
                            aria-label={t('duplicateAccessory')}
                            onClick={() => duplicate(child)}
                          >
                            <Copy size={15} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={disabled}
                            className="ui-danger-action"
                            aria-label={t('deleteAccessory')}
                            onClick={() => remove(child.id)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </summary>
                      {line(child, index, true)}
                    </details>
                  ))}
                  {children.length > 0 && (
                    <div className="qw-group-total">
                      <span>{t('productWithExtras')}</span>
                      <strong>
                        {money(
                          (totals.itemTotals[item.id] ?? 0) +
                            children.reduce(
                              (sum, i) => sum + (totals.itemTotals[i.id] ?? 0),
                              0
                            )
                        )}{' '}
                        {currency}
                      </strong>
                    </div>
                  )}
                </details>
              </ProductDisclosure>
            )}
          </div>
        );
      })}
      <div className="qw-item-tools">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
              />
            }
          >
            <Plus size={15} />
            {t('addProduct')}
            <ChevronDown size={13} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {PRODUCT_STARTERS.map((starter) => (
              <DropdownMenuItem key={starter.key} onClick={() => add(starter)}>
                {t(starter.key)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => add()}>
              {t('customProduct')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => add(undefined, undefined, 'section')}
        >
          {t('addSection')}
        </Button>
        {undo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={restore}
          >
            {t('undoRemove')}
          </Button>
        )}
      </div>
      {catalogError && (
        <p role="alert" className="qw-error">
          {t('catalogError')}
        </p>
      )}
    </div>
  );
}
