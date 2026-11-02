'use client';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import Link from 'next/link';
import { SourceBrowser } from './source-browser';
import { FollowupList } from './followup-list';
import { ArchiveHistory } from './archive-history';
import type { KnowledgeRecord } from '@/lib/quotations/knowledge/types';
export function KnowledgeLibrary() {
  const ar = useLocale() === 'ar';
  const [history, setHistory] = useState(false);
  const [followups, setFollowups] = useState(false);
  const [client, setClient] = useState<KnowledgeRecord | null>(null);
  return (
    <div className="crm-page space-y-5">
      <Link href="/quotations" className="text-sm underline">
        {ar ? 'العودة للعروض' : 'Back to quotations'}
      </Link>
      <h1 className="text-2xl font-semibold">
        {ar ? 'مصادر عروض الأسعار' : 'Quotation source library'}
      </h1>
      <p className="text-muted-foreground max-w-3xl">
        {ar
          ? 'راجع المنتجات والأسعار والمكونات والمواصفات وسجل الأعمال قبل استخدامها. البيانات الأصلية محفوظة وكل اعتماد مسجل.'
          : 'Review products, prices, components, specifications and job history before use. Original values are preserved and each review is recorded.'}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/settings?tab=products"
          className="rounded border px-3 py-2"
        >
          {ar ? 'المخزون المشترك للمنتجات' : 'Shared product inventory'}
        </Link>
        <Link
          href="/settings?tab=products&catalog=collection"
          className="rounded border px-3 py-2"
        >
          {ar ? 'الأسئلة المفتوحة والنتائج' : 'Open questions and findings'}
        </Link>
        <button
          className="rounded border px-3 py-2"
          aria-pressed={!history && !followups}
          onClick={() => {
            setHistory(false);
            setFollowups(false);
          }}
        >
          {ar ? 'المصادر والمراجعة' : 'Sources and reviews'}
        </button>
        <button
          className="rounded border px-3 py-2"
          aria-pressed={history && !followups}
          onClick={() => {
            setHistory(true);
            setFollowups(false);
          }}
        >
          {ar ? 'سجل العملاء' : 'Customer history'}
        </button>
        <button
          className="rounded border px-3 py-2"
          aria-pressed={followups}
          onClick={() => setFollowups(true)}
        >
          {ar ? 'المتابعات' : 'Follow-ups'}
        </button>
      </div>
      {followups ? (
        <FollowupList />
      ) : history ? (
        <>
          <SourceBrowser kinds={['client']} onInspect={setClient} />
          {client && (
            <ArchiveHistory
              key={client.id}
              client={client}
              onClose={() => setClient(null)}
            />
          )}
        </>
      ) : (
        <SourceBrowser />
      )}
    </div>
  );
}
