import { QuotationList } from '@/components/quotations/quotation-list';

export default function QuotationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-foreground">Quotations</h1>
      <QuotationList />
    </div>
  );
}
