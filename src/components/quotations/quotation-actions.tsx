'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, FileText, Loader2, Send } from 'lucide-react';

import type { Quotation } from '@/lib/quotations/types';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// The only caller of the Task 10 routes. "Send" never sends anything
// itself — it navigates the rep into the existing inbox thread with the
// PDF link, per the correction noted in Task 10: this codebase has no
// staged/pending outbound-message state, so a human doing the actual
// attach-and-send in the inbox IS the confirmation step, not a UI
// nicety layered on top of an auto-send call.
export function QuotationActions({
  quotation,
  onGenerated,
}: {
  quotation: Quotation;
  onGenerated: (q: Quotation) => void;
}) {
  const [busy, setBusy] = useState<'pdf' | 'send' | null>(null);

  // Derived, not fetched — the `quotation-pdfs` bucket is public (see
  // migration 061) and getPublicUrl() is a pure string construction, no
  // network call, so this stays correct across regenerate/reload without
  // needing its own state. Covers BOTH "just generated" (onGenerated
  // already updated quotation.pdfStoragePath, so this recomputes
  // immediately) and "opened a quotation that already had a PDF" (no
  // regenerate needed to see the link).
  const pdfUrl = useMemo(() => {
    if (!quotation.pdfStoragePath) return null;
    return createClient().storage.from('quotation-pdfs').getPublicUrl(quotation.pdfStoragePath).data
      .publicUrl;
  }, [quotation.pdfStoragePath]);

  async function generatePdf() {
    setBusy('pdf');
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/generate-pdf`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Failed to generate PDF (${res.status})`);
        return;
      }
      const { storagePath, revision } = await res.json();
      onGenerated({ ...quotation, pdfStoragePath: storagePath, revision });
      toast.success('PDF generated');
    } catch {
      toast.error('Failed to generate PDF — check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function prepareSend() {
    setBusy('send');
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/send`, { method: 'POST' });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: `Failed (${res.status})` }));
        toast.error(error);
        return;
      }
      const { inboxUrl, pdfUrl } = await res.json();
      // A blocking alert (not a toast) is deliberate here: the rep must
      // read and act on this PDF link in the conversation that's about
      // to open, and a toast can be missed or dismissed by the
      // navigation itself before it's been read.
      alert(`Attach and send this PDF in the conversation that's about to open:\n${pdfUrl}`);
      window.location.href = inboxUrl;
    } catch {
      toast.error('Failed to open the conversation — check your connection and try again.');
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={generatePdf} disabled={busy !== null}>
          {busy === 'pdf' ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <FileText className="size-4" />
              {quotation.pdfStoragePath ? 'Regenerate PDF' : 'Generate PDF'}
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={prepareSend}
          disabled={busy !== null || !quotation.pdfStoragePath}
        >
          {busy === 'send' ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Opening…
            </>
          ) : (
            <>
              <Send className="size-4" />
              Send via WhatsApp
            </>
          )}
        </Button>
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'ghost' })}
          >
            <ExternalLink className="size-4" />
            View PDF
          </a>
        )}
        {!quotation.pdfStoragePath && (
          <p className="text-xs text-muted-foreground">Generate the PDF before sending.</p>
        )}
      </CardContent>
    </Card>
  );
}
