'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
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
  cataloguePaymentOptions,
  catalogueTerms,
  cataloguePriceRows,
  quotationSpecification,
  type CatalogueProduct,
  type CatalogueSelection,
} from '@/lib/quotations/catalogue';
import type { KnowledgeRecord } from '@/lib/quotations/knowledge/types';

export function CataloguePicker({
  open,
  onOpenChange,
  onSelect,
  creating = false,
  productCode = '',
  defaultApplyTerms = false,
  allowPrice = true,
  initialType = 'product',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (product: CatalogueProduct, selection: CatalogueSelection) => void;
  creating?: boolean;
  productCode?: string;
  defaultApplyTerms?: boolean;
  allowPrice?: boolean;
  initialType?: string;
}) {
  const ar = useLocale() === 'ar',
    l = (en: string, arabic: string) => (ar ? arabic : en);
  const [items, setItems] = useState<CatalogueProduct[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [type, setType] = useState(initialType),
    [family, setFamily] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [price, setPrice] = useState(''),
    [payment, setPayment] = useState(''),
    [applyTerms, setApplyTerms] = useState(defaultApplyTerms);
  const [extraSources, setExtraSources] = useState<KnowledgeRecord[]>([]),
    [gridWidth, setGridWidth] = useState(''),
    [gridHeight, setGridHeight] = useState('');
  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    fetch(`/api/ai/products/${selected}/sources`, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) return;
        const b = await r.json();
        if (!c.signal.aborted)
          setExtraSources(
            b.links
              .map((x: { source: KnowledgeRecord | null }) => x.source)
              .filter(Boolean)
          );
      })
      .catch(() => {});
    return () => c.abort();
  }, [selected]);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    fetch('/api/quotations/catalogue', { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setItems(b.items);
        setError('');
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [open]);
  const product = items.find((p) => p.id === selected),
    payments = cataloguePaymentOptions(
      product?.sources.find((s) => s.kind === 'product')?.data
        .standard_payment ?? ''
    ),
    terms = product
      ? catalogueTerms(product, payment === '' ? undefined : Number(payment))
      : null;
  const results = items
    .filter(
      (p) =>
        p.kind !== 'family' &&
        (type === 'all' || p.inventory_type === type) &&
        (!family || p.familyName === family) &&
        [p.name, p.name_ar, p.sku, p.aliases.join(' '), p.productCode]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
    )
    .sort(
      (a, b) =>
        Number(b.productCode === productCode) -
          Number(a.productCode === productCode) || a.name.localeCompare(b.name)
    );
  function choose(p: CatalogueProduct) {
    setSelected(p.id);
    setError('');
    setExtraSources([]);
    setGridWidth('');
    setGridHeight('');
    setPrice('');
    setPayment('');
    setApplyTerms(defaultApplyTerms);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!creating) onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {l('Shared product catalogue', 'كتالوج المنتجات المشترك')}
          </DialogTitle>
          <DialogDescription>
            {l(
              'Choose the same products, equipment and materials maintained in Knowledge. Details and recorded prices are available here.',
              'اختر المنتجات والمعدات والمواد المسجلة في المعرفة. التفاصيل والأسعار المسجلة متاحة هنا.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={l('Search catalogue', 'بحث في الكتالوج')}
            placeholder={l(
              'Search name, Arabic name or item code',
              'ابحث بالاسم أو كود الصنف'
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-40 flex-1"
          />
          <select
            aria-label={l('Inventory type', 'نوع الصنف')}
            className="bg-background rounded-md border px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[
              ['product', 'Products', 'المنتجات'],
              [
                'equipment',
                'Equipment and accessories',
                'المعدات والإكسسوارات',
              ],
              ['component', 'Materials and components', 'المواد والمكونات'],
              ['service', 'Services', 'الخدمات'],
              ['all', 'Everything', 'الكل'],
            ].map(([v, en, a]) => (
              <option key={v} value={v}>
                {l(en, a)}
              </option>
            ))}
          </select>
          <select
            aria-label={l('Product family', 'عائلة المنتج')}
            className="bg-background max-w-full rounded-md border px-2 text-sm"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            <option value="">{l('All families', 'كل العائلات')}</option>
            {[...new Set(items.map((p) => p.familyName).filter(Boolean))]
              .sort()
              .map((f) => (
                <option key={f}>{f}</option>
              ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section
            className={`min-w-0 md:overflow-y-auto ${product ? 'hidden md:block' : ''}`}
          >
            <p className="text-muted-foreground mb-2 text-xs" role="status">
              {loading
                ? l('Loading catalogue…', 'جارٍ تحميل الكتالوج…')
                : `${results.length} ${l('matching items', 'صنف مطابق')}`}
            </p>
            <div className="divide-y rounded-lg border">
              {results.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={selected === p.id}
                  className={`focus-visible:ring-ring w-full p-3 text-start focus-visible:ring-2 ${selected === p.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                  onClick={() => choose(p)}
                >
                  <span className="block font-medium" dir="auto">
                    {ar && p.name_ar ? p.name_ar : p.name}
                  </span>
                  <small className="text-muted-foreground block">
                    {[p.sku, p.productCode, p.unit_of_measure]
                      .filter(Boolean)
                      .join(' · ')}
                    {!p.customer_visible
                      ? ` · ${l('Internal / supplier catalogue', 'كتالوج داخلي أو مورد')}`
                      : ''}
                  </small>
                </button>
              ))}
            </div>
            {!loading && !results.length && (
              <p className="py-4 text-sm">
                {l(
                  'No matching items. Try another family or inventory type.',
                  'لا توجد أصناف مطابقة. جرب عائلة أو نوعاً آخر.'
                )}
              </p>
            )}
          </section>
          <section
            className={`min-w-0 space-y-4 md:overflow-y-auto ${!product ? 'hidden md:block' : ''}`}
            aria-label={l('Selected product details', 'تفاصيل المنتج المحدد')}
          >
            {!product ? (
              <p className="text-muted-foreground p-3 text-sm">
                {l(
                  'Select an item to see its specifications, terms and recorded prices.',
                  'اختر صنفاً لعرض المواصفات والشروط والأسعار المسجلة.'
                )}
              </p>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="md:hidden"
                  onClick={() => setSelected(null)}
                >
                  {l('Back to catalogue', 'العودة للكتالوج')}
                </Button>
                <h3 className="font-semibold" dir="auto">
                  {ar && product.name_ar ? product.name_ar : product.name}
                </h3>
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {quotationSpecification(product)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {product.price_min !== null && product.price_max !== null
                    ? `${product.price_min === product.price_max ? product.price_min : `${product.price_min}–${product.price_max}`} QAR · ${product.price_unit === 'per_square_meter' ? l('per m²', 'لكل م²') : product.price_unit === 'per_meter' ? l('per metre', 'لكل متر') : product.price_unit === 'per_project' ? l('per job', 'لكل عمل') : l('per item', 'لكل صنف')}`
                    : l(
                        'No fixed rate: enter a quotation rate or choose a recorded source price below.',
                        'لا يوجد سعر ثابت: أدخل سعر العرض أو اختر سعراً مسجلاً أدناه.'
                      )}
                </p>
                {product.sources.find((r) => r.kind === 'product')?.data
                  .price_anchor_2026 && (
                  <p className="text-muted-foreground rounded border p-3 text-sm">
                    <strong className="block">
                      {l('Recorded price history', 'الأسعار التاريخية المسجلة')}
                    </strong>
                    {
                      product.sources.find((r) => r.kind === 'product')?.data
                        .price_anchor_2026
                    }
                  </p>
                )}
                {product.sources.find((r) => r.kind === 'product')?.data
                  .what_is_included && (
                  <details className="rounded border p-3 text-sm">
                    <summary className="cursor-pointer">
                      {l(
                        'Related product scope from company records',
                        'نطاق المنتج من سجلات الشركة'
                      )}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap">
                      {
                        product.sources.find((r) => r.kind === 'product')?.data
                          .what_is_included
                      }
                    </p>
                  </details>
                )}
                {product.sources.some((s) => s.kind === 'product') && (
                  <div className="space-y-2 rounded-lg border p-3 text-sm">
                    <strong>
                      {l('Recorded company terms', 'شروط الشركة المسجلة')}
                    </strong>
                    <p>
                      {terms?.deliveryTerms ||
                        product.sources.find((s) => s.kind === 'product')?.data
                          .standard_delivery}
                    </p>
                    <p>
                      {terms?.warrantyTerms ||
                        l(
                          'Warranty specified per quotation',
                          'الضمان يحدد في العرض'
                        )}
                    </p>
                    {payments.length > 0 && (
                      <label className="block">
                        {l('Payment option', 'خيار الدفع')}
                        <select
                          className="bg-background mt-1 w-full rounded border p-2"
                          aria-label={l(
                            'Catalogue payment option',
                            'خيار الدفع من الكتالوج'
                          )}
                          value={payment}
                          onChange={(e) => setPayment(e.target.value)}
                        >
                          <option value="">
                            {payments.length === 1
                              ? payments[0]
                              : l(
                                  'Choose recorded payment split',
                                  'اختر توزيع الدفعات المسجل'
                                )}
                          </option>
                          {payments.map((p, i) => (
                            <option key={i} value={i}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyTerms}
                        onChange={(e) => setApplyTerms(e.target.checked)}
                      />
                      {l(
                        'Use these terms in the quotation',
                        'استخدام هذه الشروط في العرض'
                      )}
                    </label>
                  </div>
                )}
                {extraSources.some((r) => r.kind === 'grid') && (
                  <section className="space-y-2 rounded-lg border p-3 text-sm">
                    <strong>
                      {l(
                        'Supplier size grid · EUR, excluding VAT',
                        'جدول مقاسات المورد · يورو دون ضريبة'
                      )}
                    </strong>
                    <div className="flex flex-wrap gap-2">
                      <select
                        aria-label={l('Supplier width', 'عرض المورد')}
                        className="bg-background rounded border p-2"
                        value={gridWidth}
                        onChange={(e) => setGridWidth(e.target.value)}
                      >
                        <option value="">
                          {l('Width (cm)', 'العرض (سم)')}
                        </option>
                        {[
                          ...new Set(
                            extraSources
                              .filter((r) => r.kind === 'grid')
                              .map((r) => r.data.width_cm)
                          ),
                        ]
                          .sort((a, b) => Number(a) - Number(b))
                          .map((w) => (
                            <option key={w}>{w}</option>
                          ))}
                      </select>
                      <select
                        aria-label={l('Supplier height', 'ارتفاع المورد')}
                        className="bg-background rounded border p-2"
                        value={gridHeight}
                        onChange={(e) => setGridHeight(e.target.value)}
                      >
                        <option value="">
                          {l('Height (cm)', 'الارتفاع (سم)')}
                        </option>
                        {[
                          ...new Set(
                            extraSources
                              .filter((r) => r.kind === 'grid')
                              .map((r) => r.data.height_cm)
                          ),
                        ]
                          .sort((a, b) => Number(a) - Number(b))
                          .map((h) => (
                            <option key={h}>{h}</option>
                          ))}
                      </select>
                    </div>
                    {extraSources
                      .filter(
                        (r) =>
                          r.kind === 'grid' &&
                          r.data.width_cm === gridWidth &&
                          r.data.height_cm === gridHeight
                      )
                      .map((r) => (
                        <p key={r.id}>
                          <strong>EUR {r.data.price_EUR_excl_VAT}</strong> ·{' '}
                          {r.data.mesh_and_motor}
                          <small className="text-muted-foreground block">
                            {r.source} · {r.data.width_cm} × {r.data.height_cm}{' '}
                            cm
                          </small>
                        </p>
                      ))}
                    <p className="text-muted-foreground text-xs">
                      {l(
                        'Supplier reference as recorded. Enter the selling rate in the quotation currency; no exchange rate or markup is assumed.',
                        'مرجع المورد كما ورد. أدخل سعر البيع بعملة العرض؛ لا يفترض النظام سعر تحويل أو هامش ربح.'
                      )}
                    </p>
                  </section>
                )}
                {extraSources.some(
                  (r) => r.kind === 'component' && r.data.suppliers_and_offers
                ) && (
                  <details className="rounded-lg border p-3 text-sm">
                    <summary className="cursor-pointer">
                      {l('Recorded supplier offers', 'عروض الموردين المسجلة')}
                    </summary>
                    {extraSources
                      .filter(
                        (r) =>
                          r.kind === 'component' && r.data.suppliers_and_offers
                      )
                      .map((r) => (
                        <p key={r.id} className="mt-2 whitespace-pre-wrap">
                          {r.data.suppliers_and_offers}
                        </p>
                      ))}
                  </details>
                )}
                {allowPrice && cataloguePriceRows(product).length > 0 && (
                  <div className="space-y-2 rounded-lg border p-3 text-sm">
                    <strong>
                      {l('Recorded prices · QAR', 'الأسعار المسجلة · ر.ق')}
                    </strong>
                    <p className="text-muted-foreground text-xs">
                      {l(
                        'Choose the matching model/size and source column. No column is selected automatically. Width-priced items use quantity in metres.',
                        'اختر الموديل والمقاس وعمود السعر المناسب. لا يختار النظام عموداً تلقائياً. بنود سعر العرض بالمتر تستخدم كمية بالأمتار.'
                      )}
                    </p>
                    <select
                      aria-label={l(
                        'Recorded source price',
                        'السعر المسجل في المصدر'
                      )}
                      className="bg-background w-full rounded border p-2"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    >
                      <option value="">
                        {l(
                          'Keep catalogue estimate / enter manually',
                          'الإبقاء على التقدير أو الإدخال يدوياً'
                        )}
                      </option>
                      {cataloguePriceRows(product).map((r) => (
                        <optgroup
                          key={r.id}
                          label={`${r.data.item_en} · ${r.data.unit}`}
                        >
                          {(['O', 'P', 'R', 'S'] as const)
                            .filter(
                              (c) =>
                                r.data[`col_${c}`] !== undefined &&
                                r.data[`col_${c}`] !== '' &&
                                Number.isFinite(Number(r.data[`col_${c}`]))
                            )
                            .map((c) => (
                              <option
                                key={c}
                                value={`${r.id}:${c}`}
                              >{`${r.data.item_en} · ${c}: ${r.data[`col_${c}`]} QAR / ${r.data.unit}`}</option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    {price && (
                      <small className="text-muted-foreground block">
                        {
                          cataloguePriceRows(product).find(
                            (r) => r.id === price.split(':')[0]
                          )?.data.note
                        }
                      </small>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button
            variant="ghost"
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            {l('Cancel', 'إلغاء')}
          </Button>
          <Button
            disabled={!product || creating}
            onClick={async () => {
              if (!product) return;
              try {
                const [recordId, column] = price.split(':');
                await onSelect(product, {
                  productId: product.id,
                  applyTerms,
                  paymentOption: payment === '' ? undefined : Number(payment),
                  price: recordId
                    ? { recordId, column: column as 'O' }
                    : undefined,
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Could not select this product.'
                );
              }
            }}
          >
            {creating
              ? l('Creating…', 'جارٍ الإنشاء…')
              : l('Use selected product', 'استخدام المنتج المحدد')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
