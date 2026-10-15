'use client';
import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { QuotationWorkspace } from '@/components/quotations/quotation-workspace';
import type { QuotationWithItems } from '@/lib/quotations/workspace';
import { Button } from '@/components/ui/button';
export default function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations('QuotationWorkspace');
  const [quotation, setQuotation] = useState<QuotationWithItems | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quotations/${id}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((q) => {
        setQuotation(q);
        setError(false);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(true);
      });
    return () => controller.abort();
  }, [id, retry]);
  if (error)
    return (
      <div className="crm-list-state">
        <p>{t('loadError')}</p>
        <Button
          onClick={() => {
            setError(false);
            setRetry((v) => v + 1);
          }}
        >
          {t('retry')}
        </Button>
        <Link href="/quotations">{t('back')}</Link>
      </div>
    );
  if (!quotation)
    return (
      <div className="qw-loading" role="status">
        <span className="sr-only">{t('loading')}</span>
        <div />
        <div />
        <div />
      </div>
    );
  return <QuotationWorkspace key={id} initial={quotation} />;
}
