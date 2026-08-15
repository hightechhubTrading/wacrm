import { describe, expect, it, vi } from 'vitest';

// vi.mock() factories are hoisted above every other top-level statement in
// this file, including plain `const` declarations that textually precede
// them — referencing such a const directly inside a factory throws
// "Cannot access 'x' before initialization". vi.hoisted() is the
// vitest-endorsed escape: it runs before the hoisted vi.mock() calls, so
// the mock fns it returns are safely initialized by the time any factory
// reads them. (The nested-closure trick used below for `supabaseAdmin`
// works too, since the inner arrow isn't invoked until call time — but
// vi.hoisted() is the more robust, self-documenting fix and used
// throughout.)
const { upload, getPublicUrl, screenshotPdf } = vi.hoisted(() => ({
  upload: vi.fn().mockResolvedValue({ error: null }),
  getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://x/quotation-pdfs/q-1/rev-0.pdf' } }),
  screenshotPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload, getPublicUrl }) } }),
}));

vi.mock('./render', () => ({ renderHtmlToPdf: screenshotPdf }));

vi.mock('./build-html', () => ({ buildQuotationHtml: vi.fn().mockReturnValue('<html></html>') }));

import { generateQuotationPdf } from './pdf';
import type { Quotation, QuotationItem } from './types';

const quotation = { id: 'q-1', revision: 0 } as Quotation;
const items: QuotationItem[] = [];

describe('generateQuotationPdf', () => {
  it('uploads to the quotation-scoped path and returns the public URL', async () => {
    const result = await generateQuotationPdf(quotation, items);
    expect(upload).toHaveBeenCalledWith(
      'q-1/rev-0.pdf',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(result.publicUrl).toBe('https://x/quotation-pdfs/q-1/rev-0.pdf');
  });
});
