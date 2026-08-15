'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { QuotationForm } from '@/components/quotations/quotation-form';
import { QuotationActions } from '@/components/quotations/quotation-actions';
import type { Quotation, QuotationStatus } from '@/lib/quotations/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// This repo's Next.js version requires dynamic-segment page components to
// type `params` as a Promise and unwrap it — same convention already
// applied to the Task 6/9/10 API routes and to the sibling
// automations/[id]/edit page (src/app/(dashboard)/automations/[id]/edit/page.tsx).
type Params = { params: Promise<{ id: string }> };

const STATUS_VARIANT: Record<QuotationStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  sent: 'default',
  won: 'default',
  lost: 'destructive',
  expired: 'outline',
};

export default function QuotationDetailPage({ params }: Params) {
  const { id } = use(params);
  const router = useRouter();
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/quotations/${id}`);
      if (!res.ok) {
        if (!cancelled) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Failed to load quotation (${res.status})`);
        }
        return;
      }
      const data = await res.json();
      if (!cancelled) setQuotation(data);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => router.push('/quotations')}>
          Back to quotations
        </Button>
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/quotations')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-foreground">{quotation.reference}</h1>
            <Badge variant={STATUS_VARIANT[quotation.status]}>{quotation.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {quotation.total.toLocaleString()} {quotation.currency}
          </p>
        </div>
      </div>

      <QuotationForm quotation={quotation} onSaved={setQuotation} />
      <QuotationActions quotation={quotation} onGenerated={setQuotation} />
    </div>
  );
}
