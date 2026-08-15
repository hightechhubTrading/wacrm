// src/lib/quotations/pdf.ts
import { supabaseAdmin } from './admin-client';
import { buildQuotationHtml } from './build-html';
import { renderHtmlToPdf } from './render';
import type { Quotation, QuotationItem } from './types';

export async function generateQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
): Promise<{ storagePath: string; publicUrl: string }> {
  const html = buildQuotationHtml(quotation, items);
  const pdfBuffer = await renderHtmlToPdf(html);

  const storagePath = `${quotation.id}/rev-${quotation.revision}.pdf`;
  const bucket = supabaseAdmin().storage.from('quotation-pdfs');

  const { error } = await bucket.upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data } = bucket.getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}
