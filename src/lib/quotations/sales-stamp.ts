import { QUOTATION_TEMPLATE_HTML } from './templates/quotation-html';

// Reuse the company's actual vector monogram; retain the corporate stamp separately.
const monogram = (
  QUOTATION_TEMPLATE_HTML.match(/<svg class="mark"[\s\S]*?<\/svg>/)?.[0] ?? ''
)
  .replace(/class="mark"/, 'x="119" y="69" width="82" height="83"')
  .replace(/#[0-9a-f]{6}/gi, 'currentColor');

/** Sales-only companion to the main company seal, rendered with embedded fonts. */
export const SALES_STAMP_SVG = `<svg class="sales-stamp" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 214" role="img" aria-label="High Tech Hub Trading — Sales Department / قسم المبيعات">
<defs><path id="sales-top" d="M35 111 A125 80 0 0 1 285 111"/><path id="sales-bottom" d="M27 112 A133 78 0 0 0 293 112"/></defs>
<g fill="none" stroke="currentColor"><ellipse cx="160" cy="107" rx="154" ry="99" stroke-width="3.2"/><ellipse cx="160" cy="107" rx="148" ry="93" stroke-width="1.5"/><ellipse cx="160" cy="107" rx="112" ry="64" stroke-width="2"/></g>
<g fill="currentColor" text-anchor="middle" font-family="tajawal, Arial, sans-serif" font-weight="700"><text font-size="21" direction="rtl"><textPath href="#sales-top" startOffset="50%">هاي تك هاب تريدينغ</textPath></text><text font-size="17.5" letter-spacing=".3"><textPath href="#sales-bottom" startOffset="50%">HIGH TECH HUB TRADING</textPath></text><text x="160" y="67" font-size="14">قسم المبيعات</text><text x="160" y="159" font-size="12" letter-spacing="1">SALES DEPARTMENT</text><text x="26" y="116" font-size="22">★</text><text x="294" y="116" font-size="22">★</text></g>${monogram}</svg>`;
