import { QuotationList } from '@/components/quotations/quotation-list';
import { PageIdentity } from '@/components/workspace/page-identity';
import { FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function QuotationsPage() {
  const t = await getTranslations('Workspace');
  return (
    <div className="crm-page crm-quotations-page space-y-6">
      <PageIdentity icon={FileText}>
        <h1>{t('quotations')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('quotationsHint')}</p>
      </PageIdentity>
      <QuotationList />
    </div>
  );
}
