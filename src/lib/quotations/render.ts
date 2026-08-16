// src/lib/quotations/render.ts
//
// Isolated in its own file so pdf.ts's upload/path logic (tested in
// pdf.test.ts, mocked above) never has to actually launch a browser
// in the test suite — only this thin wrapper touches Playwright.
import { chromium } from 'playwright';

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Fonts are self-hosted as embedded base64 data: URIs in the template
    // (final-review fix wave 3) — there is no external network activity to
    // wait for anymore, so 'networkidle' no longer serves a purpose and is
    // a slower, less reliable wait condition than 'load' for a fully
    // self-contained document.
    await page.setContent(html, { waitUntil: 'load' });
    // The template lays out each logical page as a fixed 210mm x 297mm
    // `.page` box, stacked in a flex column with body padding + a gap
    // between them (see quotation.html's `body`/`.page` rules) — none of
    // which is print-page-aware CSS (no @page rule). For a 2-page
    // document that stacked height comes out a few mm past 2x297mm, so
    // Playwright's own A4 pagination spills that sliver onto a 3rd,
    // near-empty page. scale: 0.9 shrinks the whole rendered page (not
    // just text) by 10%, which is enough slack to fit within 2 physical
    // A4 pages without touching the template's own pixel-tuned layout.
    return await page.pdf({ format: 'A4', printBackground: true, scale: 0.9 });
  } finally {
    await browser.close();
  }
}
