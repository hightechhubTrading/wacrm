'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  ChevronRight,
  FolderOpen,
  Package,
  ArrowUpRight,
  Trash2,
  Download,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { approvedCatalogRows } from '@/lib/ai/catalog';
import { HTH_RESEARCH } from '@/lib/ai/hth-research';
import { ProductCatalogForm } from './product-catalog-form';
import { ProductMediaGrid } from './product-media-grid';
import { CustomerGuideEditor } from './customer-guide-editor';
import { AiKnowledgeCard } from './ai-knowledge';
import { CatalogCollectionPanel } from './catalog-collection-panel';
import type { Product } from './product-catalog-types';

export function ProductCatalogPanel() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const ar = useLocale() === 'ar';
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection && window.matchMedia('(max-width: 1279px)').matches)
      editorRef.current?.scrollIntoView({ block: 'start' });
  }, [selection]);
  const [newParent, setNewParent] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('approved');
  const [section, setSection] = useState('products');
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const fetchItems = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/ai/products', { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItems(data.items ?? []);
      setError('');
    } catch (err) {
      if (!signal?.aborted)
        setError(
          err instanceof Error ? err.message : 'Failed to load catalog.'
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setItems([]);
    setSelection(null);
    setLoading(true);
    void fetchItems(controller.signal);
    return () => controller.abort();
  }, [accountId, fetchItems]);
  const reload = () => fetchItems();
  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/products/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelection(null);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : l('Could not remove entry.', 'تعذر حذف الإدخال.')
      );
    }
  };
  const importResearch = async () => {
    setImporting(true);
    try {
      const res = await fetch('/api/ai/products/research', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        l(
          `${data.added} research drafts added.`,
          `تمت إضافة ${data.added} مسودة.`
        )
      );
      await reload();
      setSection('products');
      setFilter('draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };
  const selected = items.find((p) => p.id === selection);
  const visibleToAi = new Set(approvedCatalogRows(items).map((p) => p.id));
  const matches = (p: Product) =>
    `${p.name} ${p.aliases?.join(' ')} ${p.description}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()) &&
    (filter === 'all' ||
      (filter === 'draft'
        ? !visibleToAi.has(p.id)
        : filter === 'unpriced'
          ? p.kind !== 'family' && (p.price_min == null || p.price_max == null)
          : visibleToAi.has(p.id)));
  const rows: { product: Product; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (p: Product, depth: number) => {
    if (visited.has(p.id)) return;
    visited.add(p.id);
    if (matches(p)) rows.push({ product: p, depth });
    items
      .filter((c) => c.parent_id === p.id)
      .forEach((c) => visit(c, depth + 1));
  };
  items
    .filter((p) => !p.parent_id || !items.some((c) => c.id === p.parent_id))
    .forEach((p) => visit(p, 0));
  items.filter((p) => !visited.has(p.id)).forEach((p) => visit(p, 0));
  const add = (parent = '') => {
    setNewParent(parent);
    setSelection('new');
  };
  return (
    <section
      className="min-w-0 space-y-6"
      aria-label={l(
        'Company knowledge and products',
        'معلومات الشركة والمنتجات'
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-primary text-xs font-medium">
            {l('Assistant workspace', 'مساحة عمل المساعد')}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {l('Knowledge & products', 'المعرفة والمنتجات')}
          </h2>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
            {l(
              'Give your team and assistant one clear place for product facts, prices and company information.',
              'مكان واضح للفريق والمساعد لإدارة معلومات المنتجات والأسعار والشركة.'
            )}
          </p>
        </div>
        {canEdit && section === 'products' && (
          <Button onClick={() => add()}>
            <Plus className="me-2 size-4" />
            {l('Add entry', 'إضافة إدخال')}
          </Button>
        )}
      </header>
      <nav
        aria-label={l('Knowledge sections', 'أقسام المعرفة')}
        className="border-border flex gap-1 overflow-x-auto border-b pb-3"
      >
        {[
          ['products', l('Products', 'المنتجات')],
          ['company', l('Knowledge library', 'مكتبة المعرفة')],
          ['collection', l('Collect information', 'استكمال المعلومات')],
          ['research', l('HTH research', 'مراجع هاي تك')],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant={section === id ? 'secondary' : 'ghost'}
            size="sm"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {section === 'collection' && (
        <CatalogCollectionPanel
          key={accountId}
          accountId={accountId}
          products={items}
          canEdit={canEdit}
        />
      )}
      {section === 'company' && (
        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={false}
        />
      )}
      {section === 'research' && (
        <div className="space-y-5">
          <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
            <div className="max-w-lg">
              <h3 className="font-medium">
                {l(
                  'A structure built from your company sources',
                  'هيكل مبني على مصادر شركتكم'
                )}
              </h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {l(
                  'Ten families, with distinct products underneath. Import as drafts, review the facts and approve what the assistant can use. Existing products and prices stay intact.',
                  'عشر عائلات بمنتجات واضحة تحت كل منها. استوردها كمسودات، راجع المعلومات ثم اعتمد ما يستخدمه المساعد. تبقى المنتجات والأسعار الحالية كما هي.'
                )}
              </p>
            </div>
            {canEdit && (
              <Button
                disabled={importing}
                onClick={() => void importResearch()}
              >
                <Download className="me-2 size-4" />
                {importing
                  ? l('Importing…', 'جارٍ الاستيراد…')
                  : l('Import research drafts', 'استيراد مسودات المراجع')}
              </Button>
            )}
          </div>
          <div className="grid gap-x-8 sm:grid-cols-2">
            {HTH_RESEARCH.map((f) => (
              <article key={f.key} className="border-border border-b py-5">
                <h3 className="font-medium" dir="auto">
                  {f.name}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {f.products.map((p) => p.name).join(' · ')}
                </p>
                <a
                  href={f.source}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary mt-3 inline-flex items-center gap-1 text-xs underline underline-offset-4"
                >
                  hightechub.com
                  <ArrowUpRight className="size-3" />
                </a>
              </article>
            ))}
          </div>
        </div>
      )}
      {section === 'products' && (
        <>
          <div className="text-muted-foreground flex flex-wrap gap-x-7 gap-y-2 text-xs">
            <span>
              <strong className="text-foreground me-1 font-medium tabular-nums">
                {items.length}
              </strong>
              {l('entries', 'إدخال')}
            </span>
            <span>
              <strong className="text-foreground me-1 font-medium tabular-nums">
                {visibleToAi.size}
              </strong>
              {l('available to assistant', 'متاح للمساعد')}
            </span>
            <span>
              <strong className="text-foreground me-1 font-medium tabular-nums">
                {
                  items.filter(
                    (p) =>
                      p.kind !== 'family' &&
                      (p.price_min == null || p.price_max == null)
                  ).length
                }
              </strong>
              {l('without an estimate', 'بدون سعر استرشادي')}
            </span>
          </div>
          {error && (
            <div
              role="alert"
              className="bg-destructive/10 flex flex-wrap items-center gap-3 rounded-lg p-4 text-sm"
            >
              <p>{error}</p>
              <Button size="sm" variant="outline" onClick={() => void reload()}>
                <RotateCcw className="me-1 size-3" />
                {l('Retry', 'إعادة المحاولة')}
              </Button>
            </div>
          )}
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.7fr)]">
            <aside className="min-w-0 space-y-4">
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4" />
                <Input
                  aria-label={l(
                    'Search products and other names',
                    'بحث المنتجات والأسماء الأخرى'
                  )}
                  className="ps-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={l('Find a product…', 'ابحث عن منتج…')}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  ['all', l('All', 'الكل')],
                  ['approved', l('Approved', 'معتمد')],
                  ['draft', l('Review', 'للمراجعة')],
                  ['unpriced', l('No estimate', 'بدون سعر')],
                ].map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={cn(
                      'focus-visible:ring-ring rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:ring-2',
                      filter === id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {loading || profileLoading ? (
                <div
                  aria-busy="true"
                  aria-label={l('Loading products', 'تحميل المنتجات')}
                  className="space-y-3"
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="bg-muted h-16 animate-pulse rounded-lg motion-reduce:animate-none"
                    />
                  ))}
                </div>
              ) : (
                <div
                  className="max-h-[65dvh] space-y-1 overflow-y-auto"
                  aria-label={l('Product list', 'قائمة المنتجات')}
                >
                  {rows.length === 0 && (
                    <p className="text-muted-foreground px-2 py-8 text-sm">
                      {l(
                        'No entries match. Add a product or import the HTH research.',
                        'لا توجد نتائج. أضف منتجاً أو استورد مراجع هاي تك.'
                      )}
                    </p>
                  )}
                  {rows.map(({ product: p, depth }) => (
                    <button
                      type="button"
                      key={p.id}
                      aria-current={selection === p.id ? 'true' : undefined}
                      onClick={() => {
                        setSelection(p.id);
                        setDeleteTarget(null);
                      }}
                      className={cn(
                        'focus-visible:ring-ring flex w-full gap-2.5 rounded-xl px-3 py-3 text-start transition-colors focus-visible:ring-2',
                        selection === p.id
                          ? 'bg-primary/10'
                          : 'hover:bg-muted/60',
                        depth === 1 &&
                          'border-border ms-2 w-[calc(100%-0.5rem)] border-s-2',
                        depth > 1 &&
                          'border-border ms-6 w-[calc(100%-1.5rem)] border-s-2'
                      )}
                    >
                      {p.kind === 'family' ? (
                        <FolderOpen className="text-primary mt-0.5 size-4 shrink-0" />
                      ) : (
                        <Package className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span
                          dir="auto"
                          className="block text-sm leading-snug font-medium"
                        >
                          {p.name}
                        </span>
                        <span className="text-muted-foreground mt-1.5 block text-xs">
                          {visibleToAi.has(p.id)
                            ? l('Approved', 'معتمد')
                            : l('Needs review', 'للمراجعة')}{' '}
                          ·{' '}
                          {p.kind === 'family'
                            ? `${items.filter((c) => c.parent_id === p.id).length} ${l('products', 'منتج')}`
                            : p.price_min != null && p.price_max != null
                              ? `${p.price_min}–${p.price_max} ${p.price_unit === 'per_square_meter' ? ' / m²' : ''}`
                              : l('Team confirms price', 'الفريق يؤكد السعر')}
                        </span>
                      </span>
                      <ChevronRight className="text-muted-foreground mt-1 size-3 shrink-0 rtl:rotate-180" />
                    </button>
                  ))}
                </div>
              )}
            </aside>
            <div
              ref={editorRef}
              className="border-border bg-card min-w-0 scroll-mt-6 rounded-2xl border p-5 sm:p-6"
            >
              {!selection ? (
                <div className="flex min-h-80 flex-col items-start justify-center">
                  <FolderOpen className="text-primary mb-5 size-7" />
                  <h3 className="text-lg font-medium">
                    {l('Start with a product', 'ابدأ بمنتج')}
                  </h3>
                  <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
                    {l(
                      'Choose an entry to edit its facts, pricing and sources. Group related products under a family, then add variants where specifications differ.',
                      'اختر إدخالاً لتعديل معلوماته وأسعاره ومصادره. اجمع المنتجات ضمن عائلة وأضف الأنواع الفرعية عندما تختلف المواصفات.'
                    )}
                  </p>
                  {canEdit && (
                    <Button
                      className="mt-5"
                      variant="outline"
                      onClick={() => add()}
                    >
                      <Plus className="me-2 size-4" />
                      {l('Add your first entry', 'إضافة إدخال')}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-muted-foreground mb-1 text-xs">
                        {selected?.kind === 'family'
                          ? l('Product family', 'عائلة منتجات')
                          : l('Product editor', 'محرر المنتج')}
                      </p>
                      <h3 dir="auto" className="text-lg font-semibold">
                        {selected?.name ?? l('New entry', 'إدخال جديد')}
                      </h3>
                    </div>
                    {selected && canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => add(selected.id)}
                        disabled={selected.kind === 'variant'}
                      >
                        <Plus className="me-1 size-3" />
                        {l('Add sub-product', 'إضافة نوع فرعي')}
                      </Button>
                    )}
                  </header>
                  <ProductCatalogForm
                    key={`${selection}-${newParent}`}
                    product={selected ?? null}
                    products={items}
                    initialParentId={newParent}
                    canEdit={canEdit}
                    onSaved={async (id) => {
                      await reload();
                      setSelection(id);
                    }}
                    onCancel={() => setSelection(null)}
                  />
                  {selected && (
                    <div className="border-border mt-7 border-t pt-5">
                      <CustomerGuideEditor
                        key={`${accountId}-${selected.id}`}
                        productId={selected.id}
                        canEdit={canEdit}
                      />
                    </div>
                  )}
                  {selected && (
                    <div className="border-border mt-7 border-t pt-5">
                      <ProductMediaGrid
                        productId={selected.id}
                        files={selected.files}
                        canEdit={canEdit}
                        onChanged={reload}
                      />
                    </div>
                  )}
                  {selected && canEdit && (
                    <div className="border-border mt-6 border-t pt-4">
                      {deleteTarget === selected.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm">
                            {l(
                              'Remove this entry and its files?',
                              'حذف هذا الإدخال وملفاته؟'
                            )}
                          </p>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void remove(selected.id)}
                          >
                            {l('Remove', 'حذف')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(null)}
                          >
                            {l('Keep entry', 'احتفاظ')}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setDeleteTarget(selected.id)}
                        >
                          <Trash2 className="me-2 size-3" />
                          {l('Remove entry', 'حذف الإدخال')}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
