'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { KnowledgeRecord } from '@/lib/quotations/knowledge/types';
import { recordDisplayLabel } from '@/lib/quotations/knowledge/normalization';
import { knowledgeLabel } from '@/lib/quotations/knowledge/ui-copy';
export function ProductSourceLinks({ productId }: { productId: string }) {
  const ar = useLocale() === 'ar';
  const [links, setLinks] = useState<
    { relationship: string; notes: string; source: KnowledgeRecord | null }[]
  >([]);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(20);
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/ai/products/${productId}/sources`, { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setLinks(b.links);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [productId]);
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">
        {ar
          ? 'مصادر المنتج والتسعير والمكونات'
          : 'Linked product, pricing and component sources'}
      </h3>
      <p className="text-muted-foreground text-sm">
        {ar
          ? 'العروض والمعرفة تستخدمان معرف الصنف نفسه. نحفظ الأدلة من سجلات الشركة ونجهز إعدادات الحساب بشكل منفصل.'
          : 'Knowledge and quotations use the same item ID. Company evidence is retained; calculation settings are prepared separately.'}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <ul className="divide-y text-sm">
        {links.slice(0, visible).map((link, index) => (
          <li key={link.source?.id ?? index} className="space-y-1 py-2">
            <strong>
              {link.source
                ? recordDisplayLabel(link.source, ar)
                : ar
                  ? 'مصدر مقيد الصلاحية'
                  : 'Restricted source'}
            </strong>
            <p>
              {link.relationship} ·{' '}
              {link.source ? knowledgeLabel(link.source.review_status, ar) : ''}
            </p>
            {link.source && (
              <small className="text-muted-foreground break-all">
                {link.source.source}:{link.source.source_row}
              </small>
            )}
            {link.notes && (
              <p className="text-muted-foreground">{link.notes}</p>
            )}
          </li>
        ))}
      </ul>
      {links.length > visible && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVisible((n) => n + 20)}
        >
          {ar
            ? `عرض المزيد (${links.length})`
            : `Show more (${links.length} linked records)`}
        </Button>
      )}
      {!links.length && !error && (
        <p className="text-muted-foreground text-sm">
          {ar
            ? 'لم تربط مصادر أرشيفية بهذا الصنف بعد.'
            : 'No archive sources linked to this item yet.'}
        </p>
      )}
      <Link
        className="text-sm underline"
        href="/settings?tab=products&catalog=sources"
      >
        {ar ? 'مراجعة المصادر والأسعار' : 'Review sources and prices'}
      </Link>
    </section>
  );
}
