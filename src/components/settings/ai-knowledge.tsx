'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import {
  Plus,
  RefreshCw,
  FileText,
  Search,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { HTH_COMPANY_RESEARCH } from '@/lib/ai/hth-research';
import { CatalogSelect } from './catalog-select';

interface KnowledgeDoc {
  id: string;
  title: string;
  content?: string;
  updated_at?: string;
  status: string;
  topic: string;
  product_id: string | null;
  source_url: string | null;
  source_notes: string;
}
const blank: KnowledgeDoc = {
  id: 'new',
  title: '',
  content: '',
  status: 'draft',
  topic: 'company',
  product_id: null,
  source_url: null,
  source_notes: '',
};

export function AiKnowledgeCard({
  accountId,
  canEdit,
  hasEmbeddingsKey,
}: {
  accountId: string | null;
  canEdit: boolean;
  hasEmbeddingsKey: boolean;
}) {
  const ar = useLocale() === 'ar';
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<KnowledgeDoc | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchStatus, setSearchStatus] = useState<{
    semanticConfigured: boolean;
    corrupt: boolean;
    productChunks: number;
    productVectors: number;
    pending: number;
  } | null>(null);
  const loadSearchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/ai/knowledge/reindex', { signal });
      const d = await r.json();
      if (r.ok && !signal?.aborted) setSearchStatus(d);
    } catch {
      /* Readiness is optional; document editing remains available. */
    }
  }, []);
  const fetchDocs = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/ai/knowledge', { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDocs(data.documents ?? []);
      setError('');
    } catch (err) {
      if (!signal?.aborted)
        setError(
          err instanceof Error ? err.message : 'Could not load knowledge.'
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!accountId) return;
    const c = new AbortController();
    setDocs([]);
    setEditing(null);
    setLoading(true);
    setSearchStatus(null);
    void loadSearchStatus(c.signal);
    void fetchDocs(c.signal);
    void fetch('/api/ai/products', { signal: c.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!c.signal.aborted) setProducts(d.items ?? []);
      })
      .catch(() => {});
    return () => c.abort();
  }, [accountId, fetchDocs, loadSearchStatus]);
  const open = async (id: string) => {
    setOpening(true);
    setError('');
    setDeleting(false);
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditing({ ...blank, ...data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open document.');
    } finally {
      setOpening(false);
    }
  };
  const save = async () => {
    if (!editing?.title.trim() || !editing.content?.trim()) {
      setError(l('Add a title and content.', 'أضف عنواناً ومحتوى.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(
        editing.id === 'new'
          ? '/api/ai/knowledge'
          : `/api/ai/knowledge/${editing.id}`,
        {
          method: editing.id === 'new' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.warning) toast.warning(data.warning);
      else toast.success(l('Knowledge saved.', 'تم حفظ المعلومات.'));
      setEditing(null);
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save document.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!editing || editing.id === 'new') return;
    setSaving(true);
    try {
      const r = await fetch(`/api/ai/knowledge/${editing.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('Could not remove document.');
      setEditing(null);
      setDeleting(false);
      await fetchDocs();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const reindex = async () => {
    setReindexing(true);
    try {
      const r = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const d = await r.json();
      if (!r.ok || d.success === false)
        throw new Error(d.error || 'Some entries could not be indexed.');
      await loadSearchStatus();
      toast.success(
        d.mode === 'keyword'
          ? l(
              'Keyword search refreshed. Add an embeddings key to enable semantic search.',
              'تم تحديث بحث الكلمات. أضف مفتاح التضمين لتفعيل البحث الدلالي.'
            )
          : l(
              'Search index refreshed, including approved products.',
              'تم تحديث فهرس البحث بما فيه المنتجات المعتمدة.'
            )
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReindexing(false);
    }
  };
  const patch = (value: Partial<KnowledgeDoc>) =>
    setEditing((d) => (d ? { ...d, ...value } : d));
  return (
    <section
      className="min-w-0 space-y-5"
      aria-label={l('Knowledge library', 'مكتبة المعرفة')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {l('Company knowledge', 'معلومات الشركة')}
          </h3>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm leading-relaxed">
            {l(
              'Keep company facts, service guidance and policies in focused documents. Product-specific details can link to the catalog.',
              'نظم معلومات الشركة والخدمات والسياسات في مستندات محددة. اربط المعلومات الخاصة بمنتج بالكتالوج.'
            )}
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => {
              setEditing({ ...blank });
              setError('');
              setDeleting(false);
            }}
          >
            <Plus className="me-2 size-4" />
            {l('Add document', 'إضافة مستند')}
          </Button>
        )}
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute start-3 top-3 size-4" />
          <Input
            className="ps-9"
            aria-label={l('Search knowledge', 'بحث المعرفة')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={l('Search documents…', 'ابحث عن مستند…')}
          />
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            disabled={reindexing}
            onClick={() => void reindex()}
          >
            <RefreshCw
              className={cn('me-2 size-3', reindexing && 'animate-spin')}
            />
            {l('Refresh search', 'تحديث البحث')}
          </Button>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm"
        >
          {error}
        </p>
      )}
      {loading ? (
        <div
          className="bg-muted h-28 animate-pulse rounded-xl motion-reduce:animate-none"
          aria-label={l('Loading knowledge', 'تحميل المعرفة')}
          aria-busy="true"
        />
      ) : (
        <div className="space-y-1">
          {docs
            .filter((d) => d.title.toLowerCase().includes(search.toLowerCase()))
            .map((d) => (
              <button
                type="button"
                key={d.id}
                disabled={opening}
                onClick={() => void open(d.id)}
                className={cn(
                  'hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center gap-3 rounded-xl px-4 py-3 text-start transition-colors focus-visible:ring-2',
                  editing?.id === d.id && 'bg-primary/10'
                )}
              >
                <FileText className="text-primary size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block text-sm font-medium">
                    {d.title}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {d.topic ?? 'company'} ·{' '}
                    {d.status === 'draft'
                      ? l(
                          'Draft · hidden from assistant',
                          'مسودة · غير متاحة للمساعد'
                        )
                      : l('Approved', 'معتمد')}
                  </span>
                </span>
                {d.source_url && (
                  <ArrowUpRight className="text-muted-foreground size-3" />
                )}
              </button>
            ))}
          {docs.length === 0 && !editing && (
            <div className="bg-muted/40 rounded-xl p-5">
              <h4 className="font-medium">
                {l(
                  'Start with clear company facts',
                  'ابدأ بمعلومات واضحة عن الشركة'
                )}
              </h4>
              <p className="text-muted-foreground mt-2 text-sm">
                {l(
                  'The HTH research includes contact details, service scope and source notes for review.',
                  'تتضمن مراجع هاي تك معلومات التواصل ونطاق الخدمة وملاحظات المصادر للمراجعة.'
                )}
              </p>
              {canEdit && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() =>
                    setEditing({ ...blank, ...HTH_COMPANY_RESEARCH })
                  }
                >
                  {l('Review HTH company draft', 'مراجعة مسودة معلومات هاي تك')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {canEdit && docs.length > 0 && !editing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing({ ...blank, ...HTH_COMPANY_RESEARCH })}
        >
          {l(
            'Review researched HTH company facts',
            'مراجعة معلومات هاي تك من المصادر'
          )}
        </Button>
      )}
      {opening && (
        <p role="status" className="text-muted-foreground text-sm">
          {l('Opening document…', 'جارٍ فتح المستند…')}
        </p>
      )}
      {editing && (
        <form
          className="border-border bg-card space-y-5 rounded-2xl border p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="kb-title">
              {l('Document title', 'عنوان المستند')}
            </Label>
            <Input
              id="kb-title"
              dir="auto"
              value={editing.title}
              disabled={!canEdit || saving}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="kb-topic">{l('Topic', 'الموضوع')}</Label>
              <CatalogSelect
                id="kb-topic"
                value={editing.topic}
                disabled={!canEdit || saving}
                onChange={(e) => patch({ topic: e.target.value })}
              >
                {[
                  ['company', l('Company facts', 'معلومات الشركة')],
                  ['product', l('Product information', 'معلومات منتج')],
                  ['service', l('Service & maintenance', 'الخدمة والصيانة')],
                  ['policy', l('Sales policy', 'سياسة المبيعات')],
                ].map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </CatalogSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-product">
                {l('Related product', 'المنتج المرتبط')}
              </Label>
              <CatalogSelect
                id="kb-product"
                value={editing.product_id ?? ''}
                disabled={!canEdit || saving}
                onChange={(e) => patch({ product_id: e.target.value || null })}
              >
                <option value="">{l('Company-wide', 'عام للشركة')}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </CatalogSelect>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-content">
              {l(
                'Facts the assistant may use',
                'معلومات يمكن للمساعد استخدامها'
              )}
            </Label>
            <Textarea
              id="kb-content"
              rows={10}
              dir="auto"
              value={editing.content ?? ''}
              disabled={!canEdit || saving}
              onChange={(e) => patch({ content: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              {l(
                'Use one topic per document. Keep instructions, unresolved conflicts and unverified claims in source notes.',
                'خصص موضوعاً لكل مستند. ضع التعليمات والتعارضات والادعاءات غير الموثقة في ملاحظات المصادر.'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-source">{l('Source link', 'رابط المصدر')}</Label>
            <Input
              id="kb-source"
              type="url"
              value={editing.source_url ?? ''}
              disabled={!canEdit || saving}
              onChange={(e) => patch({ source_url: e.target.value || null })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-notes">
              {l(
                'Sources, conflicts & review notes',
                'المصادر والتعارضات وملاحظات المراجعة'
              )}
            </Label>
            <Textarea
              id="kb-notes"
              rows={3}
              dir="auto"
              value={editing.source_notes}
              disabled={!canEdit || saving}
              onChange={(e) => patch({ source_notes: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-status">
              {l('Assistant access', 'استخدام المساعد')}
            </Label>
            <CatalogSelect
              id="kb-status"
              value={editing.status}
              disabled={!canEdit || saving}
              onChange={(e) => patch({ status: e.target.value })}
            >
              <option value="draft">
                {l('Draft · review only', 'مسودة · للمراجعة')}
              </option>
              <option value="approved">
                {l('Approved · available to assistant', 'معتمد · متاح للمساعد')}
              </option>
            </CatalogSelect>
          </div>
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div>
              {canEdit &&
                editing.id !== 'new' &&
                (deleting ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void remove()}
                  >
                    {l('Confirm removal', 'تأكيد الحذف')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(true)}
                  >
                    {l('Remove document', 'حذف المستند')}
                  </Button>
                ))}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setEditing(null);
                  setDeleting(false);
                }}
              >
                {l('Close', 'إغلاق')}
              </Button>
              {canEdit && (
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                  {l('Save document', 'حفظ المستند')}
                </Button>
              )}
            </div>
          </div>
        </form>
      )}
      {searchStatus && (
        <p role="status" className="text-muted-foreground text-sm">
          {searchStatus.corrupt
            ? l(
                'The embeddings key needs attention. Re-enter it in AI settings.',
                'مفتاح التضمين يحتاج مراجعة. أعد إدخاله في إعدادات المساعد.'
              )
            : searchStatus.semanticConfigured
              ? l(
                  `${searchStatus.productVectors} / ${searchStatus.productChunks} approved product search passages have vectors. ${searchStatus.pending} pending; refresh search to index the next batch.`,
                  `${searchStatus.productVectors} من ${searchStatus.productChunks} مقطع بحث لمنتجات معتمدة مفهرس دلالياً. ${searchStatus.pending} بانتظار الفهرسة؛ حدّث البحث لفهرسة الدفعة التالية.`
                )
              : l(
                  'Product keyword search is available. Add an embeddings key in AI settings to enable semantic search.',
                  'بحث الكلمات للمنتجات متاح. أضف مفتاح التضمين في إعدادات المساعد لتفعيل البحث الدلالي.'
                )}{' '}
        </p>
      )}
      {!searchStatus && hasEmbeddingsKey && (
        <p className="text-muted-foreground text-xs">
          {l(
            'Semantic search is configured for this account.',
            'البحث الدلالي معد لهذا الحساب.'
          )}
        </p>
      )}
    </section>
  );
}
