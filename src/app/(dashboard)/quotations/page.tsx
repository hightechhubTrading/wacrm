import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { QuotationList } from '@/components/quotations/quotation-list';
import { PageIdentity } from '@/components/workspace/page-identity';
import { FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function QuotationsPage() {
  const ar = (await getLocale()) === 'ar';
  const t = await getTranslations('Workspace');
  return (
    <div className="crm-page crm-quotations-page space-y-6">
      <PageIdentity icon={FileText}>
        <h1>{t('quotations')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('quotationsHint')}
        </p>
      </PageIdentity>
      <Link
        className="hover:bg-muted inline-flex rounded-md border px-3 py-2 text-sm"
        href="/quotations/knowledge"
      >
        {ar
          ? 'مصادر الأسعار وسجل العملاء'
          : 'Price sources and customer history'}
      </Link>
      <QuotationList />
    </div>
  );
}
