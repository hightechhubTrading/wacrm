'use client';
import './product-workspace.css';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Search, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  sellableCatalogue,
  catalogueChoices,
  productProfile,
} from '@/lib/quotations/product-profile';
import {
  quotationSpecification,
  type CatalogueProduct,
  type CatalogueSelection,
} from '@/lib/quotations/catalogue';
export function CataloguePicker({
  open,
  onOpenChange,
  onSelect,
  creating = false,
  productCode = '',
  defaultApplyTerms = false,
  initialType = 'product',
  componentMode = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (p: CatalogueProduct, s: CatalogueSelection) => void;
  creating?: boolean;
  productCode?: string;
  defaultApplyTerms?: boolean;
  allowPrice?: boolean;
  initialType?: string;
  componentMode?: boolean;
}) {
  const ar = useLocale() === 'ar',
    l = (en: string, a: string) => (ar ? a : en);
  const [items, setItems] = useState<CatalogueProduct[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [family, setFamily] = useState(''),
    [type, setType] = useState(initialType),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [configurationId, setConfigurationId] = useState(''),
    [allEquipment, setAllEquipment] = useState(false),
    [componentKind, setComponentKind] = useState<
      'Included' | 'Accessory' | 'Optional' | undefined
    >();
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    fetch('/api/quotations/catalogue', { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        if (!c.signal.aborted) setItems(b.items);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [open]);
  const leaves = sellableCatalogue(items),
    compatible = leaves.filter(
      (p) =>
        p.inventory_type === 'equipment' &&
        p.sources.some((r) => r.data.family === productCode)
    ),
    available = leaves.filter(
      (p) =>
        p.inventory_type === type &&
        (type !== 'equipment' ||
          !productCode ||
          !compatible.length ||
          allEquipment ||
          compatible.some((c) => c.id === p.id))
    ),
    results = available
      .filter(
        (p) =>
          (!family || p.familyName === family) &&
          [p.name, p.name_ar, p.productCode, p.sku, ...p.aliases]
            .join(' ')
            .toLowerCase()
            .includes(query.toLowerCase())
      )
      .sort(
        (a, b) =>
          Number(b.productCode === productCode) -
            Number(a.productCode === productCode) ||
          a.name.localeCompare(b.name)
      ),
    choices = catalogueChoices(results),
    choice = choices.find((c) => c.products.some((p) => p.id === selectedId)),
    selected =
      choice?.products.length === 1
        ? choice.products[0]
        : choice?.products.find((p) => p.id === configurationId);
  const types = [
    ['product', 'Products', 'المنتجات'],
    ['equipment', 'Equipment', 'المعدات'],
    ['service', 'Services', 'الخدمات'],
    ...(initialType === 'component'
      ? [['component', 'Materials', 'المواد']]
      : []),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!creating) onOpenChange(v);
      }}
    >
      <DialogContent className="qp-catalogue-dialog sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {l('Add to quotation', 'إضافة إلى عرض السعر')}
          </DialogTitle>
          <DialogDescription>
            {l(
              'Choose a product configuration, equipment or service.',
              'اختر تكوين المنتج أو المعدات أو الخدمة.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div
          className="qp-catalogue-tabs"
          role="group"
          aria-label={l('Item type', 'نوع البند')}
        >
          {types.map(([v, en, a]) => (
            <Button
              type="button"
              key={v}
              variant={type === v ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={type === v}
              onClick={() => {
                setType(v);
                setAllEquipment(false);
                setFamily('');
                setSelectedId(null);
                setConfigurationId('');
              }}
            >
              {l(en, a)}
            </Button>
          ))}
        </div>
        <div className="qp-catalogue-search">
          <Search size={17} />
          <Input
            aria-label={l('Search catalogue', 'بحث في الكتالوج')}
            placeholder={l(
              'Search products or company codes…',
              'ابحث عن منتج أو كود الصنف…'
            )}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedId(null);
            }}
          />
          <select
            aria-label={l('Product family', 'عائلة المنتج')}
            value={family}
            onChange={(e) => {
              setFamily(e.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">{l('All families', 'كل العائلات')}</option>
            {[...new Set(available.map((p) => p.familyName).filter(Boolean))]
              .sort()
              .map((f) => (
                <option key={f}>{f}</option>
              ))}
          </select>
        </div>
        {type === 'equipment' && productCode && compatible.length > 0 && (
          <div className="qp-compatible">
            <span>
              {allEquipment
                ? l('All equipment', 'كل المعدات')
                : l(
                    'Equipment recorded for this product family',
                    'المعدات المسجلة لعائلة هذا المنتج'
                  )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={allEquipment}
              onClick={() => {
                setAllEquipment(!allEquipment);
                setSelectedId(null);
              }}
            >
              {allEquipment
                ? l('Show matching equipment', 'عرض المعدات المطابقة')
                : l('Show all equipment', 'عرض كل المعدات')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div
          className={`qp-catalogue-body ${choice ? 'qp-catalogue-selected' : ''}`}
        >
          <div
            className="qp-catalogue-results"
            aria-label={l('Catalogue results', 'نتائج الكتالوج')}
          >
            <div className="qp-catalogue-count">
              {loading
                ? l('Loading catalogue…', 'جاري تحميل الكتالوج…')
                : results.length + ' ' + l('configurations', 'تكوينات')}
            </div>
            {choices.map((entry) => {
              const p = entry.products[0],
                profile = productProfile(p);
              return (
                <button
                  type="button"
                  key={entry.key}
                  className="qp-catalogue-row"
                  aria-pressed={entry.key === choice?.key}
                  onClick={() => {
                    setSelectedId(p.id);
                    setConfigurationId('');
                  }}
                >
                  <span>
                    <strong dir="auto">
                      {entry.products.length > 1
                        ? entry.title
                        : ar && p.name_ar
                          ? p.name_ar
                          : p.name}
                    </strong>
                    <small dir="auto">
                      {p.familyName}
                      {entry.products.length > 1
                        ? ' · ' +
                          entry.products.length +
                          ' ' +
                          l('configurations', 'تكوينات')
                        : ''}
                    </small>
                  </span>
                  <span className="qp-catalogue-code" dir="ltr">
                    {entry.products.length > 1
                      ? profile.code
                      : (p.sku ?? profile.code)}
                  </span>
                  <ArrowRight size={15} />
                </button>
              );
            })}
            {!loading && !results.length && (
              <p className="qp-empty-list">
                {l(
                  'No matching configurations. Try another family or search term.',
                  'لا توجد تكوينات مطابقة. جرب عائلة أخرى أو عبارة بحث مختلفة.'
                )}
              </p>
            )}
          </div>
          <aside className="qp-catalogue-detail">
            {choice ? (
              <>
                <button
                  type="button"
                  className="qp-back-items"
                  onClick={() => setSelectedId(null)}
                >
                  {l('← Results', '← النتائج')}
                </button>
                <span className="qp-eyebrow">
                  {selected?.sku ?? productProfile(choice.products[0]).code}
                </span>
                <h3 dir="auto">
                  {selected
                    ? ar && selected.name_ar
                      ? selected.name_ar
                      : selected.name
                    : choice.title}
                </h3>
                {choice.products.length > 1 && (
                  <label className="qp-configuration-choice">
                    {l('Configuration', 'التكوين')}
                    <select
                      aria-label={l('Configuration', 'التكوين')}
                      value={configurationId}
                      onChange={(e) => setConfigurationId(e.target.value)}
                    >
                      <option value="">
                        {l(
                          'Choose fabric and motor configuration',
                          'اختر تكوين القماش والمحرك'
                        )}
                      </option>
                      {choice.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name.split(' · ').slice(1).join(' · ')}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <ul>
                  {quotationSpecification(selected ?? choice.products[0])
                    .split('\n')
                    .filter(Boolean)
                    .slice(0, 5)
                    .map((line, i) => (
                      <li key={i} dir="auto">
                        {line}
                      </li>
                    ))}
                </ul>
                <p className="qp-subtle">
                  {l(
                    'Set dimensions, finish, equipment and price in the item editor. Payment and delivery are organized in Commercial terms.',
                    'حدد الأبعاد والتشطيب والمعدات والسعر في محرر البند. تُنظم الدفعات والتسليم في الشروط التجارية.'
                  )}
                </p>
              </>
            ) : (
              <div className="qp-editor-empty">
                <h3>
                  {l(
                    'Choose the configuration you are offering',
                    'اختر التكوين المطلوب للعرض'
                  )}
                </h3>
                <p>
                  {l(
                    'Products are grouped by family. Equipment and services have their own lists.',
                    'المنتجات مرتبة حسب العائلة. للمعدات والخدمات قوائم مستقلة.'
                  )}
                </p>
              </div>
            )}
          </aside>
        </div>
        {componentMode && (
          <fieldset className="qp-component-charge">
            <legend>
              {l('How is this equipment priced?', 'كيف تُحتسب هذه المعدات؟')}
            </legend>
            {(
              [
                [
                  'Included',
                  'Included in product price',
                  'مشمول في سعر المنتج',
                ],
                ['Accessory', 'Additional charge', 'تكلفة إضافية'],
                ['Optional', 'Optional upgrade', 'ترقية اختيارية'],
              ] as const
            ).map(([kind, en, a]) => (
              <Button
                key={kind}
                type="button"
                variant={componentKind === kind ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={componentKind === kind}
                onClick={() => setComponentKind(kind)}
              >
                {l(en, a)}
              </Button>
            ))}
          </fieldset>
        )}
        <div className="qp-catalogue-footer">
          <Button
            type="button"
            variant="ghost"
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            {l('Cancel', 'إلغاء')}
          </Button>
          <Button
            type="button"
            disabled={
              !selected || creating || (componentMode && !componentKind)
            }
            onClick={() => {
              if (selected)
                onSelect(selected, {
                  productId: selected.id,
                  applyTerms: defaultApplyTerms,
                  ...(componentMode ? { componentKind } : {}),
                });
            }}
          >
            {creating
              ? l('Adding…', 'جاري الإضافة…')
              : l('Add selected item', 'إضافة البند المحدد')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
