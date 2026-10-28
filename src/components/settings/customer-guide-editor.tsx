'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { BookOpen, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CatalogSelect } from './catalog-select';
import {
  EMPTY_GUIDE,
  GUIDE_SECTION_KEYS,
  parseGuideSections,
  type CustomerGuide,
  type GuideSections,
} from '@/lib/ai/customer-guides';

export function CustomerGuideEditor({
  productId,
  canEdit,
  onSaved,
  onClose,
}: {
  productId: string;
  canEdit: boolean;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const ar = useLocale() === 'ar';
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  const [guide, setGuide] = useState<CustomerGuide | null>(null);
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [inherited, setInherited] = useState(false);
  const [sections, setSections] = useState<GuideSections>({ ...EMPTY_GUIDE });
  const [status, setStatus] = useState<'draft' | 'approved'>('draft');
  const [sourceUrl, setSourceUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch(
          `/api/ai/customer-guides?product_id=${encodeURIComponent(productId)}`,
          { signal }
        );
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (signal?.aborted) return;
        setGuide(d.guide);
        setOwner(d.owner);
        setInherited(d.inherited);
        setSections(d.guide?.guide_sections ?? { ...EMPTY_GUIDE });
        setStatus(d.guide?.status ?? 'draft');
        setSourceUrl(d.guide?.source_url ?? '');
        setNotes(d.guide?.source_notes ?? '');
        setEditing(false);
        setError('');
      } catch (err) {
        if (!signal?.aborted)
          setError(
            err instanceof Error
              ? err.message
              : 'Could not load customer guide.'
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [productId]
  );
  useEffect(() => {
    const c = new AbortController();
    setGuide(null);
    setOwner(null);
    setEditing(false);
    setLoading(true);
    setError('');
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  const save = async () => {
    setError('');
    try {
      parseGuideSections(sections, status === 'approved');
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/ai/customer-guides', {
        method: guide ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: guide?.id,
          updated_at: guide?.updated_at,
          product_id: guide?.product_id ?? productId,
          status,
          guide_sections: sections,
          source_url: sourceUrl || null,
          source_notes: notes,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.warning) toast.warning(d.warning);
      else toast.success(l('Customer guide saved.', 'تم حفظ دليل العميل.'));
      await load();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save guide.');
    } finally {
      setSaving(false);
    }
  };
  const labels: Record<keyof GuideSections, [string, string]> = {
    explanation: ['Explain simply', 'اشرح ببساطة'],
    options: ['Compare options', 'قارن الخيارات'],
    selection: ['Help choose', 'ساعد في الاختيار'],
    next_question: ['Useful next question', 'سؤال المتابعة المناسب'],
    faq: ['Common questions', 'الأسئلة الشائعة'],
  };
  const hints: Record<keyof GuideSections, [string, string]> = {
    explanation: [
      'What it is and what it does, in customer language.',
      'ما المنتج وما وظيفته بلغة العميل.',
    ],
    options: [
      'Explain category differences without copying exact specifications between variants.',
      'اشرح فروق الفئات دون نقل مواصفات دقيقة بين الأنواع.',
    ],
    selection: [
      'Use needs and preferences; keep performance promises on the exact product.',
      'اربط الاختيار بالاحتياجات والتفضيلات، واترك وعود الأداء للمنتج المحدد.',
    ],
    next_question: [
      'One useful preference first; dimensions when sizing is actually needed.',
      'تفضيل مفيد أولاً، والمقاسات عندما نحتاج تحديد المقاس فعلاً.',
    ],
    faq: [
      'Short questions and useful answers. Exact prices and warranties stay in product facts.',
      'أسئلة قصيرة وإجابات مفيدة. تبقى الأسعار والضمانات الدقيقة في معلومات المنتج.',
    ],
  };
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={l('Customer guide', 'دليل العميل')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="text-primary size-4" />
            {l('Customer guide', 'دليل العميل')}
          </h4>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm">
            {l(
              'Help customers understand the product, compare options and choose. Stored once in the knowledge library.',
              'ساعد العملاء على فهم المنتج ومقارنة الخيارات والاختيار. يُحفظ الدليل مرة واحدة في مكتبة المعرفة.'
            )}
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            {l('Close', 'إغلاق')}
          </Button>
        )}
      </header>
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          {l('Loading guide…', 'جارٍ تحميل الدليل…')}
        </p>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              className="text-destructive bg-destructive/10 rounded-lg p-3 text-sm"
            >
              {error}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void load()}
                disabled={!canEdit || saving}
              >
                <RefreshCw className="me-1 size-3" />
                {l('Reload', 'إعادة التحميل')}
              </Button>
            </div>
          )}
          {guide && (
            <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                {guide.status === 'approved'
                  ? l('Approved for general education', 'معتمد للشرح العام')
                  : l(
                      'Draft · review before assistant use',
                      'مسودة · تُراجع قبل استخدام المساعد'
                    )}
              </span>
              {inherited && (
                <span dir="auto">
                  {l('Shared from: ', 'مشترك من: ')}
                  {owner?.name}
                </span>
              )}
            </div>
          )}
          {inherited && (
            <p className="border-border border-s-2 ps-3 text-sm">
              {l(
                'This guide is shared with other products in this branch. Editing it updates the same knowledge document for all of them.',
                'هذا الدليل مشترك مع منتجات أخرى في هذا الفرع. تعديله يحدث مستند المعرفة نفسه للجميع.'
              )}
            </p>
          )}
          {!guide && !editing && !error && (
            <p className="text-muted-foreground text-sm">
              {l(
                'No guide yet. Create one here, or prepare family guide drafts from the knowledge library.',
                'لا يوجد دليل بعد. أنشئه هنا أو جهز مسودات أدلة العائلات من مكتبة المعرفة.'
              )}
            </p>
          )}
          {!editing && guide && (
            <div className="divide-border divide-y">
              {GUIDE_SECTION_KEYS.map((key) => (
                <details
                  key={key}
                  className="py-3"
                  open={key === 'explanation'}
                >
                  <summary className="cursor-pointer text-sm font-medium">
                    {l(...labels[key])}
                  </summary>
                  <p
                    dir="auto"
                    className="text-muted-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap"
                  >
                    {guide.guide_sections[key] ||
                      l('Not recorded yet.', 'لم تُسجل بعد.')}
                  </p>
                </details>
              ))}
            </div>
          )}
          {!editing && canEdit && !error && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              {guide
                ? inherited
                  ? l('Edit shared guide', 'تعديل الدليل المشترك')
                  : l('Edit customer guide', 'تعديل دليل العميل')
                : l('Create customer guide', 'إنشاء دليل العميل')}
            </Button>
          )}
          {editing && (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <p className="text-muted-foreground text-xs">
                {l(
                  'General explanations do not establish HTH availability, prices, exact specifications or warranty. Keep those in product facts.',
                  'الشرح العام لا يثبت توفر المنتج لدى الشركة أو سعره أو مواصفاته الدقيقة أو ضمانه. تبقى هذه في معلومات المنتج.'
                )}
              </p>
              {GUIDE_SECTION_KEYS.map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`guide-${productId}-${key}`}>
                    {l(...labels[key])}
                  </Label>
                  <Textarea
                    id={`guide-${productId}-${key}`}
                    dir="auto"
                    rows={key === 'faq' ? 5 : 4}
                    maxLength={6000}
                    value={sections[key]}
                    required={key === 'explanation' || status === 'approved'}
                    disabled={!canEdit || saving}
                    onChange={(e) =>
                      setSections((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    {l(...hints[key])}
                  </p>
                </div>
              ))}
              <details className="border-border border-t pt-3">
                <summary className="cursor-pointer text-sm">
                  {l('Sources & review notes', 'المصادر وملاحظات المراجعة')}
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`guide-source-${productId}`}>
                      {l('Source link', 'رابط المصدر')}
                    </Label>
                    <Input
                      id={`guide-source-${productId}`}
                      type="url"
                      value={sourceUrl}
                      disabled={!canEdit || saving}
                      onChange={(e) => setSourceUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`guide-notes-${productId}`}>
                      {l('Internal review notes', 'ملاحظات المراجعة الداخلية')}
                    </Label>
                    <Textarea
                      id={`guide-notes-${productId}`}
                      dir="auto"
                      rows={3}
                      maxLength={12000}
                      value={notes}
                      disabled={!canEdit || saving}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
              </details>
              <div className="space-y-2">
                <Label htmlFor={`guide-status-${productId}`}>
                  {l('Assistant access', 'استخدام المساعد')}
                </Label>
                <CatalogSelect
                  id={`guide-status-${productId}`}
                  value={status}
                  disabled={!canEdit || saving}
                  onChange={(e) =>
                    setStatus(e.target.value as 'draft' | 'approved')
                  }
                >
                  <option value="draft">
                    {l('Draft · review only', 'مسودة · للمراجعة فقط')}
                  </option>
                  <option value="approved">
                    {l(
                      'Approved · general education only',
                      'معتمد · للشرح العام فقط'
                    )}
                  </option>
                </CatalogSelect>
                <p className="text-muted-foreground text-xs">
                  {l(
                    'Guide approval is separate from approval of HTH product facts. It does not approve the linked catalog entry.',
                    'اعتماد الدليل منفصل عن اعتماد معلومات منتج الشركة ولا يعتمد سجل الكتالوج المرتبط.'
                  )}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canEdit || saving}
                  onClick={() => void load()}
                >
                  {l('Cancel', 'إلغاء')}
                </Button>
                <Button type="submit" disabled={!canEdit || saving}>
                  {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                  {l('Save guide', 'حفظ الدليل')}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
