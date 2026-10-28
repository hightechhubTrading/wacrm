'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Download, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CatalogSelect } from './catalog-select';
import { approvedCatalogRows } from '@/lib/ai/catalog';
import {
  catalogGaps,
  collectionProductRows,
  type CatalogQuestion,
} from '@/lib/ai/catalog-collection';
import type { Product } from './product-catalog-types';

const blank: CatalogQuestion = {
  id: 'new',
  product_id: null,
  question: '',
  answer: '',
  evidence: '',
  confirmed_by: '',
  confirmed_on: null,
  status: 'open',
};
export function CatalogCollectionPanel({
  accountId,
  products,
  canEdit,
}: {
  accountId: string | null;
  products: Product[];
  canEdit: boolean;
}) {
  const ar = useLocale() === 'ar';
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  const [questions, setQuestions] = useState<CatalogQuestion[]>([]);
  const [editing, setEditing] = useState<CatalogQuestion | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [show, setShow] = useState('approved');
  const [status, setStatus] = useState('open');
  const fetchQuestions = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/ai/catalog-questions', { signal });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (!signal?.aborted) {
        setQuestions(d.questions);
        setError('');
      }
    } catch (err) {
      if (!signal?.aborted)
        setError(
          err instanceof Error ? err.message : 'Could not load questions.'
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setQuestions([]);
    setEditing(null);
    setError('');
    setLoading(true);
    void fetchQuestions(controller.signal);
    return () => controller.abort();
  }, [accountId, fetchQuestions]);
  const available = new Set(approvedCatalogRows(products).map((p) => p.id));
  const leaves = collectionProductRows(products);
  const gapLabel = {
    price: l('Price / unit', 'السعر والوحدة'),
    specifications: l('Specifications', 'المواصفات'),
    files: l('Direct files', 'ملفات خاصة بالمنتج'),
  };
  const patch = (values: Partial<CatalogQuestion>) =>
    setEditing((q) => (q ? { ...q, ...values } : q));
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/ai/catalog-questions', {
        method: editing.id === 'new' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setEditing(null);
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save answer.');
    } finally {
      setSaving(false);
    }
  };
  const exportWorkbook = async () => {
    setExporting(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const book = new ExcelJS.Workbook();
      const instructions = book.addWorksheet(l('Read me', 'تعليمات'));
      instructions.addRows([
        [l('Product information collection', 'استكمال معلومات المنتجات')],
        [
          l(
            'Approved records can still have missing details. Draft entries are proposals: confirm whether supplied; do not treat them as unavailable.',
            'قد تنقص تفاصيل السجلات المعتمدة. المسودات مقترحات: أكد توفرها ولا تعتبرها غير متاحة.'
          ),
        ],
        [
          l(
            'Some draft proposals overlap approved products. Confirm the same product or a distinct system before adding it.',
            'قد تتكرر المسودات مع منتجات معتمدة. أكد هل هي نفس المنتج أم نظام مستقل قبل إضافتها.'
          ),
        ],
        [
          l(
            'Answers remain collection work until reviewed and entered on the exact product or approved knowledge document.',
            'تبقى الإجابات ضمن الاستكمال حتى مراجعتها وتسجيلها على المنتج المحدد أو مستند معرفة معتمد.'
          ),
        ],
        [
          l(
            'Blank price cells mean no recorded estimate. Do not borrow a price or attachment from another variant.',
            'خلايا السعر الفارغة تعني عدم وجود سعر مسجل. لا تنقل السعر أو الملفات من نوع آخر.'
          ),
        ],
      ]);
      instructions.getColumn(1).width = 110;
      const addProducts = (name: string, approved: boolean) => {
        const sheet = book.addWorksheet(name, {
          views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }],
        });
        sheet.addRow([
          l('Product / variant', 'المنتج أو النوع'),
          l('On file', 'المعلومات المسجلة'),
          l('Price minimum', 'أقل سعر'),
          l('Price maximum', 'أعلى سعر'),
          l('Recorded unit', 'الوحدة المسجلة'),
          l('Price qualifications', 'شروط السعر'),
          l('Missing fields', 'الحقول الناقصة'),
          l('Direct files', 'عدد الملفات المباشرة'),
          l('Client answer / correction', 'إجابة العميل أو التصحيح'),
          l('Evidence / file', 'الدليل أو الملف'),
          l('Confirmed by', 'أكدها'),
          l('Date', 'التاريخ'),
        ]);
        for (const p of leaves.filter((p) => available.has(p.id) === approved))
          sheet.addRow([
            p.name,
            [p.description, p.specifications, p.limitations]
              .filter(Boolean)
              .join('\n'),
            p.price_min,
            p.price_max,
            p.price_unit,
            p.price_notes,
            catalogGaps(p)
              .map((g) => gapLabel[g])
              .join(', '),
            p.files.length,
            '',
            '',
            '',
            '',
          ]);
        sheet.columns.forEach((c, i) => {
          c.width = i === 0 ? 34 : i === 1 ? 65 : 23;
        });
        return sheet;
      };
      addProducts(l('Recorded products', 'المنتجات المسجلة'), true);
      addProducts(l('Confirm supplied', 'تأكيد المنتجات المتوفرة'), false);
      const qs = book.addWorksheet(
        l('Questions and answers', 'الأسئلة والإجابات'),
        { views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }] }
      );
      qs.addRow([
        l('Product', 'المنتج'),
        l('Question', 'السؤال'),
        l('Status', 'الحالة'),
        l('Answer', 'الإجابة'),
        l('Evidence', 'الدليل'),
        l('Confirmed by', 'أكدها'),
        l('Date', 'التاريخ'),
      ]);
      for (const q of questions)
        qs.addRow([
          products.find((p) => p.id === q.product_id)?.name ??
            l('Shared / assign product', 'مشترك أو حدد المنتج'),
          q.question,
          q.status,
          q.answer,
          q.evidence,
          q.confirmed_by,
          q.confirmed_on,
        ]);
      qs.columns.forEach((c, i) => {
        c.width = i === 1 || i === 3 ? 65 : 25;
      });
      for (const sheet of book.worksheets) {
        sheet.eachRow((row) => {
          row.alignment = { vertical: 'top', wrapText: true };
        });
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF193D38' },
        };
        sheet.pageSetup = {
          orientation: 'landscape',
          paperSize: 9,
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        };
      }
      const buffer = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'product-information-collection.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(l('Could not export workbook.', 'تعذر تصدير الملف.'));
    } finally {
      setExporting(false);
    }
  };
  return (
    <section
      className="min-w-0 space-y-5"
      aria-label={l('Information to collect', 'المعلومات المطلوب استكمالها')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {l('Collect missing information', 'استكمال المعلومات الناقصة')}
          </h3>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {l(
              'Review recorded facts, confirm proposed products and collect answers here. Answers are kept separate from the assistant’s approved knowledge.',
              'راجع المعلومات المسجلة وأكد المنتجات المقترحة واجمع الإجابات هنا. تبقى الإجابات منفصلة عن معرفة المساعد المعتمدة.'
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !!error || exporting}
          onClick={() => void exportWorkbook()}
        >
          <Download className="me-2 size-4" />
          {l('Client workbook', 'ملف للعميل')}
        </Button>
      </header>
      {error && (
        <div
          role="alert"
          className="text-destructive bg-destructive/10 rounded-lg p-3 text-sm"
        >
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchQuestions()}
          >
            {l('Retry', 'إعادة المحاولة')}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {[
          ['approved', l('Recorded products', 'المنتجات المسجلة')],
          ['draft', l('Confirm supplied', 'تأكيد التوفر')],
        ].map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={show === id ? 'secondary' : 'ghost'}
            aria-pressed={show === id}
            onClick={() => setShow(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full text-start text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              {[
                l('Product / variant', 'المنتج أو النوع'),
                l('Recorded facts', 'المعلومات المسجلة'),
                l('Missing fields', 'الحقول الناقصة'),
                l('Questions', 'الأسئلة'),
              ].map((t) => (
                <th key={t} className="p-3 text-start font-medium">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaves
              .filter((p) => available.has(p.id) === (show === 'approved'))
              .map((p) => (
                <tr key={p.id} className="border-border border-t">
                  <td className="min-w-44 p-3 align-top" dir="auto">
                    {p.name}
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {p.kind === 'variant'
                        ? products.find((parent) => parent.id === p.parent_id)
                            ?.name
                        : l('Product overview', 'نظرة عامة للمنتج')}
                    </span>
                  </td>
                  <td className="max-w-md min-w-52 p-3 align-top">
                    <details>
                      <summary className="cursor-pointer">
                        {l('View what is on file', 'عرض المعلومات المسجلة')}
                      </summary>
                      <p dir="auto" className="mt-2 whitespace-pre-wrap">
                        {[
                          p.description,
                          p.specifications,
                          p.price_notes,
                          p.limitations,
                        ]
                          .filter(Boolean)
                          .join('\n\n')}
                      </p>
                    </details>
                  </td>
                  <td className="min-w-36 p-3 align-top">
                    {catalogGaps(p)
                      .map((g) => gapLabel[g])
                      .join(' · ') ||
                      l('Review terms and evidence', 'راجع الشروط والأدلة')}
                  </td>
                  <td className="p-3 align-top">
                    <span className="tabular-nums">
                      {
                        questions.filter(
                          (q) => q.product_id === p.id && q.status !== 'closed'
                        ).length
                      }
                    </span>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={l(
                          `Add question for ${p.name}`,
                          `إضافة سؤال عن ${p.name}`
                        )}
                        onClick={() =>
                          setEditing({ ...blank, product_id: p.id })
                        }
                      >
                        <Plus className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-medium">
          {l('Questions & client answers', 'الأسئلة وإجابات العميل')}
        </h4>
        <div className="flex gap-2">
          <CatalogSelect
            aria-label={l('Filter questions', 'تصفية الأسئلة')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              ['open', l('Open', 'مفتوح')],
              [
                'answered',
                l('Answered · needs review', 'تمت الإجابة · للمراجعة'),
              ],
              ['closed', l('Closed', 'مغلق')],
              ['all', l('All', 'الكل')],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </CatalogSelect>
          {canEdit && (
            <Button size="sm" onClick={() => setEditing({ ...blank })}>
              <Plus className="me-1 size-4" />
              {l('Add question', 'إضافة سؤال')}
            </Button>
          )}
        </div>
      </div>
      {loading ? (
        <p role="status">{l('Loading questions…', 'جارٍ تحميل الأسئلة…')}</p>
      ) : (
        <div className="divide-border divide-y">
          {questions
            .filter((q) => status === 'all' || q.status === status)
            .map((q) => (
              <button
                type="button"
                key={q.id}
                onClick={() => setEditing(q)}
                className="hover:bg-muted/50 focus-visible:ring-ring w-full rounded-md p-3 text-start focus-visible:ring-2"
              >
                <span
                  className="text-muted-foreground block text-xs"
                  dir="auto"
                >
                  {products.find((p) => p.id === q.product_id)?.name ??
                    l('Shared / unassigned', 'مشترك أو غير محدد')}
                </span>
                <span className="mt-1 block text-sm" dir="auto">
                  {q.question}
                </span>
                {q.answer && (
                  <span
                    className="text-muted-foreground mt-2 block text-sm"
                    dir="auto"
                  >
                    {q.answer}
                  </span>
                )}
              </button>
            ))}
          {questions.filter((q) => status === 'all' || q.status === status)
            .length === 0 && (
            <p className="text-muted-foreground py-4 text-sm">
              {l('No questions in this view.', 'لا توجد أسئلة في هذا العرض.')}
            </p>
          )}
        </div>
      )}
      {editing && (
        <form
          className="border-border space-y-4 rounded-xl border p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="text-muted-foreground text-sm">
            {l(
              'Saving an answer does not publish it to the assistant. Review it, then update the exact product or a focused knowledge document.',
              'حفظ الإجابة لا ينشرها للمساعد. راجعها ثم حدث المنتج المحدد أو مستند معرفة مخصص.'
            )}
          </p>
          <div className="space-y-2">
            <Label htmlFor="cq-product">{l('Product', 'المنتج')}</Label>
            <CatalogSelect
              id="cq-product"
              value={editing.product_id ?? ''}
              disabled={!canEdit || saving}
              onChange={(e) => patch({ product_id: e.target.value || null })}
            >
              <option value="">
                {l('Shared / unassigned', 'مشترك أو غير محدد')}
              </option>
              {leaves.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </CatalogSelect>
          </div>
          {(
            [
              ['question', l('Question', 'السؤال')],
              ['answer', l('Client answer', 'إجابة العميل')],
              [
                'evidence',
                l('Evidence / attachment reference', 'مرجع الدليل أو الملف'),
              ],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`cq-${key}`}>{label}</Label>
              <Textarea
                id={`cq-${key}`}
                dir="auto"
                value={editing[key]}
                rows={key === 'answer' ? 4 : 2}
                maxLength={key === 'answer' ? 12000 : 2000}
                required={key === 'question'}
                disabled={!canEdit || saving}
                onChange={(e) => patch({ [key]: e.target.value })}
              />
            </div>
          ))}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cq-by">{l('Confirmed by', 'أكدها')}</Label>
              <Input
                id="cq-by"
                dir="auto"
                maxLength={200}
                value={editing.confirmed_by}
                disabled={!canEdit || saving}
                onChange={(e) => patch({ confirmed_by: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cq-date">
                {l('Confirmation date', 'تاريخ التأكيد')}
              </Label>
              <Input
                id="cq-date"
                type="date"
                value={editing.confirmed_on ?? ''}
                disabled={!canEdit || saving}
                onChange={(e) =>
                  patch({ confirmed_on: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cq-status">
                {l('Collection status', 'حالة الاستكمال')}
              </Label>
              <CatalogSelect
                id="cq-status"
                value={editing.status}
                disabled={!canEdit || saving}
                onChange={(e) =>
                  patch({ status: e.target.value as CatalogQuestion['status'] })
                }
              >
                <option value="open">{l('Open', 'مفتوح')}</option>
                <option value="answered">
                  {l('Answered · needs review', 'تمت الإجابة · للمراجعة')}
                </option>
                <option value="closed">{l('Closed', 'مغلق')}</option>
              </CatalogSelect>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setEditing(null)}
            >
              {l('Close', 'إغلاق')}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                {l('Save collection record', 'حفظ سجل الاستكمال')}
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
