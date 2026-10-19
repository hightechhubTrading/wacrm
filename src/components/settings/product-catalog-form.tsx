'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2,
  Check,
  FileText,
  SlidersHorizontal,
  Banknote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  catalogPriceError,
  type CatalogKind,
  type ReviewStatus,
} from '@/lib/ai/catalog';
import { CatalogSelect } from './catalog-select';
import type { Product } from './product-catalog-types';

export function ProductCatalogForm({
  product,
  products = [],
  initialParentId = '',
  canEdit,
  onSaved,
  onCancel,
}: {
  product: Product | null;
  products?: Product[];
  initialParentId?: string;
  canEdit: boolean;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const ar = useLocale() === 'ar';
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  const [tab, setTab] = useState('details');
  const [name, setName] = useState(product?.name ?? '');
  const [tagLabel, setTagLabel] = useState(product?.tag_label ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [kind, setKind] = useState<CatalogKind>(
    product?.kind ??
      (initialParentId &&
      products.find((p) => p.id === initialParentId)?.kind !== 'family'
        ? 'variant'
        : 'product')
  );
  const [parentId, setParentId] = useState(
    product?.parent_id ?? initialParentId
  );
  const [status, setStatus] = useState<ReviewStatus>(
    product?.status ?? 'draft'
  );
  const [aliases, setAliases] = useState(product?.aliases?.join(', ') ?? '');
  const [specifications, setSpecifications] = useState(
    product?.specifications ?? ''
  );
  const [limitations, setLimitations] = useState(product?.limitations ?? '');
  const [sourceUrl, setSourceUrl] = useState(product?.source_url ?? '');
  const [sourceNotes, setSourceNotes] = useState(product?.source_notes ?? '');
  const [priceMin, setPriceMin] = useState(
    product?.price_min?.toString() ?? ''
  );
  const [priceMax, setPriceMax] = useState(
    product?.price_max?.toString() ?? ''
  );
  const [priceUnit, setPriceUnit] = useState(product?.price_unit ?? '');
  const [priceNotes, setPriceNotes] = useState(product?.price_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const descendants = new Set<string>(product ? [product.id] : []);
  for (let i = 0; i < products.length; i++)
    for (const p of products)
      if (p.parent_id && descendants.has(p.parent_id)) descendants.add(p.id);

  const save = async () => {
    const payload = {
      name: name.trim(),
      description: description.trim(),
      tag_label: tagLabel.trim(),
      kind,
      parent_id: kind === 'family' ? null : parentId || null,
      status,
      aliases: aliases
        .split(/[,،\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      specifications,
      limitations,
      source_url: sourceUrl || null,
      source_notes: sourceNotes,
      price_min: priceMin.trim() ? Number(priceMin) : null,
      price_max: priceMax.trim() ? Number(priceMax) : null,
      price_unit: priceUnit || null,
      price_notes: priceNotes || null,
    };
    const validation =
      !payload.name || !payload.description
        ? l('Name and description are required.', 'الاسم والوصف مطلوبان.')
        : catalogPriceError(payload);
    if (validation) {
      setError(validation);
      return;
    }
    if (kind === 'variant' && !parentId) {
      setError(l('Choose the parent product.', 'اختر المنتج الرئيسي.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(
        product ? `/api/ai/products/${product.id}` : '/api/ai/products',
        {
          method: product ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error ??
            l('Could not save. Try again.', 'تعذر الحفظ. حاول مجدداً.')
        );
        return;
      }
      toast.success(l('Product saved.', 'تم حفظ المنتج.'));
      onSaved(product?.id ?? data.id);
    } catch {
      setError(
        l(
          'Connection failed. Your edits are still here.',
          'تعذر الاتصال. تعديلاتك محفوظة هنا.'
        )
      );
    } finally {
      setSaving(false);
    }
  };
  const field = (
    id: string,
    label: string,
    value: string,
    update: (s: string) => void,
    multiline = false,
    hint?: string
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          dir="auto"
          rows={4}
          value={value}
          onChange={(e) => update(e.target.value)}
          disabled={!canEdit || saving}
        />
      ) : (
        <Input
          id={id}
          dir="auto"
          value={value}
          onChange={(e) => update(e.target.value)}
          disabled={!canEdit || saving}
        />
      )}{' '}
      {hint && (
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      )}
    </div>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      <div
        className="border-border flex flex-wrap gap-1 border-b pb-3"
        role="tablist"
        aria-label={l('Product editor', 'محرر المنتج')}
      >
        {[
          ['details', l('Overview', 'نظرة عامة'), SlidersHorizontal],
          ['pricing', l('Pricing', 'التسعير'), Banknote],
          ['evidence', l('Facts & sources', 'المعلومات والمصادر'), FileText],
        ].map(([id, label, Icon]) => (
          <Button
            key={String(id)}
            type="button"
            role="tab"
            id={`product-tab-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(e) => {
              const ids = ['details', 'pricing', 'evidence'];
              let i = ids.indexOf(tab);
              if (e.key === 'Home') i = 0;
              else if (e.key === 'End') i = 2;
              else if (e.key === 'ArrowRight') i = (i + (ar ? 2 : 1)) % 3;
              else if (e.key === 'ArrowLeft') i = (i + (ar ? 1 : 2)) % 3;
              else return;
              e.preventDefault();
              setTab(ids[i]);
              document.getElementById(`product-tab-${ids[i]}`)?.focus();
            }}
            aria-selected={tab === id}
            aria-controls={`catalog-${id}`}
            variant={tab === id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTab(String(id))}
          >
            {typeof Icon !== 'string' && <Icon className="me-2 size-4" />}
            {String(label)}
          </Button>
        ))}
      </div>
      <div
        id="catalog-details"
        role="tabpanel"
        aria-labelledby="product-tab-details"
        hidden={tab !== 'details'}
        className="space-y-5"
      >
        {field('product-name', l('Product name', 'اسم المنتج'), name, setName)}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="product-kind">
              {l('Entry type', 'نوع الإدخال')}
            </Label>
            <CatalogSelect
              id="product-kind"
              value={kind}
              disabled={!canEdit || saving}
              onChange={(e) => setKind(e.target.value as CatalogKind)}
            >
              <option value="family">
                {l('Product family', 'عائلة منتجات')}
              </option>
              <option value="product">{l('Product', 'منتج')}</option>
              <option value="variant">
                {l('Variant / sub-product', 'نوع فرعي')}
              </option>
            </CatalogSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-parent">
              {l('Belongs to', 'يتبع إلى')}
            </Label>
            <CatalogSelect
              id="product-parent"
              value={kind === 'family' ? '' : parentId}
              disabled={!canEdit || saving || kind === 'family'}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{l('No parent', 'بدون منتج رئيسي')}</option>
              {products
                .filter(
                  (p) =>
                    !descendants.has(p.id) &&
                    (kind === 'variant'
                      ? p.kind === 'product'
                      : p.kind === 'family')
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </CatalogSelect>
          </div>
        </div>
        {field(
          'product-description',
          l('What this product is', 'تعريف المنتج'),
          description,
          setDescription,
          true,
          l(
            'Describe its use and how it differs from similar products.',
            'اشرح الاستخدام والفرق بينه وبين المنتجات المشابهة.'
          )
        )}
        {field(
          'product-aliases',
          l('Other names customers use', 'أسماء أخرى يستخدمها العملاء'),
          aliases,
          setAliases,
          false,
          l(
            'Separate Arabic, English and informal names with commas.',
            'افصل الأسماء العربية والإنجليزية والمتداولة بفواصل.'
          )
        )}
        {field(
          'product-tag-label',
          l('Contact tag', 'وسم جهة الاتصال'),
          tagLabel,
          setTagLabel
        )}
      </div>
      <div
        id="catalog-pricing"
        role="tabpanel"
        aria-labelledby="product-tab-pricing"
        hidden={tab !== 'pricing'}
        className="space-y-5"
      >
        <div className="bg-muted/50 rounded-xl p-4 text-sm leading-relaxed">
          {l(
            'An approved estimate helps the assistant answer price questions immediately. Each product and variant keeps its own price.',
            'السعر الاسترشادي المعتمد يساعد المساعد على الإجابة مباشرة. لكل منتج ونوع فرعي سعره الخاص.'
          )}
        </div>
        {kind === 'family' ? (
          <p className="text-muted-foreground text-sm">
            {l(
              'Open a product or variant to set its price. Families group products.',
              'افتح منتجاً أو نوعاً فرعياً لتحديد سعره. العائلات تجمع المنتجات.'
            )}
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {field(
                'product-price-min',
                l('Estimate from', 'السعر من'),
                priceMin,
                setPriceMin
              )}
              {field(
                'product-price-max',
                l('Estimate to', 'السعر إلى'),
                priceMax,
                setPriceMax
              )}
              <div className="space-y-2">
                <Label htmlFor="product-price-unit">
                  {l('Unit', 'الوحدة')}
                </Label>
                <CatalogSelect
                  id="product-price-unit"
                  value={priceUnit}
                  disabled={!canEdit || saving}
                  onChange={(e) => setPriceUnit(e.target.value)}
                >
                  <option value="">{l('Choose unit', 'اختر الوحدة')}</option>
                  <option value="per_square_meter">
                    {l('Per square metre (m²)', 'للمتر المربع')}
                  </option>
                  <option value="per_meter">
                    {l('Per linear metre', 'للمتر الطولي')}
                  </option>
                  <option value="per_item">{l('Per item', 'للقطعة')}</option>
                  <option value="per_project">
                    {l('Per project', 'للمشروع')}
                  </option>
                  {priceUnit &&
                    ![
                      'per_square_meter',
                      'per_meter',
                      'per_item',
                      'per_project',
                    ].includes(priceUnit) && (
                      <option value={priceUnit}>{priceUnit}</option>
                    )}
                </CatalogSelect>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              {l(
                'Uses your account currency. Leave both limits empty when the team must quote. Missing pricing does not prevent other product answers.',
                'تستخدم عملة الحساب. اترك الحدين فارغين إن كان التسعير من الفريق. غياب السعر لا يمنع الإجابة عن المنتج.'
              )}
            </p>
          </>
        )}
        {field(
          'product-price-notes',
          l(
            'What is included, excluded or charged separately',
            'المشمول والمستثنى والتكاليف الإضافية'
          ),
          priceNotes,
          setPriceNotes,
          true,
          l(
            'Record minimum billed area, motor costs and installation scope explicitly.',
            'حدد الحد الأدنى للمساحة وتكلفة المحرك ونطاق التركيب بوضوح.'
          )
        )}
      </div>
      <div
        id="catalog-evidence"
        role="tabpanel"
        aria-labelledby="product-tab-evidence"
        hidden={tab !== 'evidence'}
        className="space-y-5"
      >
        {field(
          'product-specifications',
          l(
            'Confirmed specifications & options',
            'المواصفات والخيارات المؤكدة'
          ),
          specifications,
          setSpecifications,
          true
        )}
        {field(
          'product-limitations',
          l(
            'Limits & details the team must confirm',
            'الحدود والتفاصيل التي يؤكدها الفريق'
          ),
          limitations,
          setLimitations,
          true,
          l(
            'Keep unverified ratings, guarantees and compatibility claims out of specifications.',
            'لا تضع تصنيفات أو ضمانات أو توافقاً غير موثق ضمن المواصفات.'
          )
        )}
        {field(
          'product-source-url',
          l('Source link', 'رابط المصدر'),
          sourceUrl,
          setSourceUrl
        )}
        {field(
          'product-source-notes',
          l('Source notes & review context', 'ملاحظات المصدر والمراجعة'),
          sourceNotes,
          setSourceNotes,
          true
        )}
      </div>
      <div className="border-border flex flex-wrap items-end justify-between gap-4 border-t pt-5">
        <div className="max-w-xs space-y-2">
          <Label htmlFor="product-status">
            {l('Assistant access', 'استخدام المساعد')}
          </Label>
          <CatalogSelect
            id="product-status"
            value={status}
            disabled={!canEdit || saving}
            onChange={(e) => setStatus(e.target.value as ReviewStatus)}
          >
            <option value="draft">
              {l('Draft · team review only', 'مسودة · لمراجعة الفريق')}
            </option>
            <option value="approved">
              {l(
                'Approved · available to the assistant',
                'معتمد · متاح للمساعد'
              )}
            </option>
          </CatalogSelect>
          <p className="text-muted-foreground text-xs">
            {l(
              'A draft parent also hides its children from the assistant.',
              'المنتج الرئيسي غير المعتمد يحجب أنواعه الفرعية عن المساعد.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            {l('Close', 'إغلاق')}
          </Button>
          {canEdit && (
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <Check className="me-2 size-4" />
              )}
              {l('Save changes', 'حفظ التعديلات')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
