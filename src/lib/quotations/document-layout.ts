/** Self-contained print layout. Natural pagination; commercial rows never contain long specifications. */
export const DOCUMENT_CSS = `
:root{--ink:#332720;--muted:#75685f;--line:#dfd4cb;--wash:#f6f1ec;--accent:#593a2b;--blue:#138dc6}
*{box-sizing:border-box}body{margin:0;background:#edf0f3;color:var(--ink);font:10pt/1.5 'tajawal',Arial,sans-serif}.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:12mm 14mm 16mm}.ar{font-family:'tajawal',sans-serif;direction:rtl;unicode-bidi:isolate}.muted{color:var(--muted)}.mono,.ref-v{font-family:'space-mono',monospace;font-size:8pt}.brand{display:flex;justify-content:space-between;align-items:center;gap:8mm;padding-bottom:4mm;border-bottom:1px solid var(--line)}.lockup{display:flex;align-items:center;gap:4mm}.mark{width:12mm;height:14mm;color:var(--blue);flex:none}.nm-ar{font-size:14pt;font-weight:700}.nm-en{font-size:8pt;font-weight:700;letter-spacing:.5pt}.contact{font-size:7.7pt;text-align:end;line-height:1.8;color:var(--muted)}.doc-heading{display:flex;justify-content:space-between;align-items:center;gap:8mm;padding:5mm 0 4mm}.doc-heading h1{font-size:25pt;line-height:1.1;margin:0;font-weight:800;letter-spacing:-1pt}.doc-heading h1 span{display:block;font-size:12pt;font-weight:500;letter-spacing:0;margin-top:2mm}.doc-reference{font-family:'space-mono',monospace;font-size:10pt;font-weight:700}.metadata{display:grid;grid-template-columns:repeat(3,1fr);background:var(--wash);padding:2mm 4mm;gap:4mm;font-size:8pt;border-radius:1mm}.ref-k{font-size:6.5pt;letter-spacing:.7pt;color:var(--muted);margin-bottom:1mm}.party-grid{display:grid;grid-template-columns:1fr 1fr;gap:10mm;padding:4mm 0}.party-title{font-size:8pt;color:var(--muted);margin:0 0 2mm}.party-name{font-size:12pt;font-weight:650;margin-bottom:2mm}.party-grid dl{margin:0;display:grid;grid-template-columns:23mm minmax(0,1fr);gap:1.4mm 3mm;font-size:8.5pt}.party-grid dt{color:var(--muted)}.party-grid dd{margin:0;overflow-wrap:anywhere}h2{font-size:12pt;margin:5mm 0 2.5mm;line-height:1.4;font-weight:700}h2 .ar{font-size:9pt;font-weight:500;margin-inline-start:3mm;color:var(--muted)}.scope-heading{padding:3mm 0 4mm;border-top:2px solid var(--ink)}.scope-heading h2{margin:0 0 1mm}.scope-heading p{margin:0;font-size:9pt}.items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}.items th{background:var(--wash);font-size:7pt;letter-spacing:.2pt;font-weight:600;text-align:start;padding:3mm 2mm;border-block:1px solid var(--line)}.items th small{display:block;font-size:6.5pt;font-weight:400;letter-spacing:0}.items td{vertical-align:top;padding:3.5mm 2mm;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.items .num{text-align:end;font-variant-numeric:tabular-nums}.items .code{font-size:7.5pt;color:var(--muted)}.it{font-weight:650;display:block;line-height:1.4}.items .ar,.items .spec{display:block;font-size:7.4pt;margin-top:1mm;line-height:1.5}.items .spec{color:var(--muted)}.section-row td{background:var(--wash);font-weight:700}.optional td{color:var(--muted)}.totals-wrap{display:flex;justify-content:space-between;gap:10mm;padding-top:5mm;break-inside:avoid}.amount-words{font-size:8pt;line-height:1.7;max-width:100mm}.amount-words p{margin:1mm 0}.totals{min-width:62mm;font-size:9pt}.totals>div{display:flex;justify-content:space-between;gap:6mm;margin-bottom:2mm}.grand-total{border-top:2px solid var(--ink);padding-top:3mm;font-size:13pt;font-weight:700}.grand-total small{font-size:8pt;font-weight:400}.specifications{margin-top:4mm}.product-spec{margin-bottom:4mm;break-inside:avoid;border:1px solid var(--line);border-radius:1mm}.product-spec header{display:flex;align-items:baseline;gap:3mm;background:var(--wash);padding:3mm 4mm;border-bottom:1px solid var(--line)}.product-spec header h3{font-size:10pt;margin:0;font-weight:650}.product-spec header span{font-size:8pt;color:var(--muted)}.spec-content{padding:3mm 4mm;font-size:8.5pt}.spec-content ul{margin:0;padding-inline-start:4mm;columns:2;column-gap:8mm}.spec-content li{margin-bottom:1.5mm;break-inside:avoid;line-height:1.6}.configuration-facts{display:grid;grid-template-columns:1fr 1fr;gap:2mm 6mm;margin-bottom:3mm;padding-bottom:3mm;border-bottom:1px solid var(--line)}.configuration-facts div{display:grid;grid-template-columns:30mm 1fr;gap:2mm}.configuration-facts dt{color:var(--muted)}.configuration-facts dd{margin:0;overflow-wrap:anywhere}.included-equipment{margin-top:3mm;padding-top:3mm;border-top:1px solid var(--line);font-size:8.5pt}.included-equipment p{margin:1mm 0}.commercial{break-inside:avoid;margin-top:4mm;border-top:2px solid var(--ink);padding-top:1mm}.commercial h2{break-after:avoid}.scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin-bottom:4mm}.scope-grid h3{font-size:9pt;margin:0 0 2mm}.scope-grid ul{font-size:8.5pt;margin:0;padding-inline-start:4mm}.scope-grid li{margin-bottom:1mm}.pay{width:100%;border-collapse:collapse;font-size:8.5pt;break-inside:avoid}.pay th{text-align:start;background:var(--wash);font-size:7.5pt;padding:2mm;border-bottom:1px solid var(--line)}.pay td{padding:2.5mm;border-bottom:1px solid var(--line)}.pay .num{text-align:end;white-space:nowrap}.terms{display:grid;grid-template-columns:1fr 1fr;gap:4mm 7mm;margin:4mm 0;font-size:8.5pt}.terms dt{font-weight:650;margin-bottom:1mm}.terms dd{margin:0;white-space:pre-line;overflow-wrap:anywhere}.commercial-text{font-size:8.5pt;line-height:1.7;white-space:pre-line}.sales-signoff{margin-top:3mm;break-inside:avoid;border-top:1px solid var(--line);padding-top:2mm}.sales-signoff h2{margin:0 0 2mm;font-size:11pt}.sales-signoff p{margin:1.5mm 0;font-size:8pt;color:var(--muted)}.sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm;margin-top:5mm}.sig{border-top:1px solid var(--line);padding-top:2mm;font-size:7pt;color:var(--muted)}.foot{margin-top:3mm;padding-top:2mm;border-top:1px solid var(--line);font-size:7.5pt;color:var(--muted)}.draft-missing{color:#976313}tr{break-inside:avoid}thead{display:table-header-group}p,li{orphans:2;widows:2}h2,h3{break-after:avoid}
.configuration-facts{display:flex;flex-wrap:wrap;gap:2mm 6mm}.configuration-facts div{display:flex;max-width:100%;align-items:baseline;gap:2mm}.configuration-facts dt{flex:none}.configuration-facts dd{min-width:0}.metadata{display:flex;justify-content:space-between;gap:4mm}.metadata>div{display:flex;align-items:center;gap:3mm}.metadata .ref-k{margin:0}.doc-heading{padding:2mm 0}.doc-heading h1{font-size:22pt}.party-grid{padding:2mm 0}.product-spec header{padding:2mm 4mm}
/* Chocolate brown anchors the hierarchy; the original company mark retains its blue. */
.doc-heading h1,.doc-reference,h2,.party-name{color:var(--accent)}
.brand{border-bottom:1px solid var(--line)}
.scope-heading,.commercial{border-top-color:var(--accent)}
.items th{background:var(--accent);color:#fff;border-color:var(--accent);padding:2.5mm 2mm}
.items th small{color:#f2e8df}
.items td{padding:2.8mm 2mm}
.items .measurement{white-space:nowrap;font-size:8pt;overflow-wrap:normal}
.items .num{overflow-wrap:normal}.quantity-count{white-space:nowrap;font-size:7.5pt}
.metadata{padding:2mm 3mm;gap:3mm}
.metadata>div{white-space:nowrap;gap:2mm}
.doc-heading h1 span{display:inline-block;margin:0 0 0 4mm;font-size:11pt;vertical-align:middle}
.party-grid{gap:7mm;padding:3mm 0}
.party-grid dl{grid-template-columns:max-content minmax(0,1fr);gap:1mm 2mm}
.party-name{font-size:11pt;margin-bottom:1mm}
.party-title{margin-bottom:1mm}
.grand-total{background:var(--accent);color:#fff;border:0;padding:2.5mm 3mm;white-space:nowrap;border-radius:1mm}
.amount-words{max-width:105mm}
.product-spec{border-radius:0;border-width:0 0 1px;margin-bottom:3mm}
.product-spec header{border:0;border-inline-start:3px solid var(--accent);padding:1.5mm 3mm}
.product-spec header span{color:var(--accent);white-space:nowrap}
.spec-content{padding:2mm 3mm}
.configuration-facts{margin:0 0 2mm;padding-bottom:2mm;gap:1.5mm 5mm}
.configuration-facts div{flex-wrap:wrap;gap:.5mm 2mm}
.configuration-facts dt{font-size:7.5pt}
.configuration-facts dd{font-weight:600}
.spec-content ul{columns:auto;display:flex;flex-wrap:wrap;gap:1mm 6mm;padding-inline-start:4mm}
.spec-content li{flex:1 1 65mm;margin:0;line-height:1.45}
.included-equipment{margin-top:2mm;padding-top:2mm}
.included-equipment strong{font-size:8pt;color:var(--accent)}
.included-equipment p{display:inline;margin-inline-start:3mm}
.scope-grid{gap:6mm;margin-bottom:3mm}
.scope-grid h3{margin-bottom:1mm;color:var(--accent)}
.pay{table-layout:fixed}
.pay th:first-child{width:64%}
.pay td{padding:2mm}
.payment-ar{display:inline-block;margin-inline-start:1mm;font-size:8pt;color:var(--muted)}
.terms{grid-template-columns:1fr;gap:2mm;margin:3mm 0}
.terms>div{display:grid;grid-template-columns:62mm minmax(0,1fr);gap:3mm;break-inside:avoid}
.terms dt{margin:0;color:var(--accent)}
.terms dd{line-height:1.45}
.sigs{position:relative;isolation:isolate;align-items:start;margin-top:5mm;gap:6mm;overflow:visible}
.sig{position:relative;border:0;padding:0;min-width:0;overflow:visible}
.sig>div:not(.sig-value){border-top:1px solid var(--line);padding-top:2mm;min-height:7mm}
.sig-value{height:19mm;display:flex;align-items:flex-end;padding-bottom:.6mm;overflow-wrap:anywhere}
.sales-name{font-size:11pt;font-weight:700;color:var(--accent)}.sales-phone{font-size:8pt}
.signed-date{font-family:'space-mono',monospace;font-size:9pt;color:var(--ink)}
/* The seal is a separate ink layer: it does not size the row or obey its borders. */
.sales-signoff{padding-bottom:5mm}.stamp-slot{position:relative;overflow:visible}
.sales-stamp{position:absolute;z-index:3;pointer-events:none;left:50%;top:50%;width:55mm;height:37mm;color:#293779;opacity:.9;mix-blend-mode:multiply;transform:translate(-50%,-43%) rotate(-9deg);transform-origin:center;overflow:visible}
@media print{.sales-stamp{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.reference-image{break-inside:avoid;margin:4mm 0}.reference-image h2{margin:0 0 2mm}.reference-image img{display:block;max-width:100%;max-height:95mm;width:auto;height:auto;object-fit:contain;border:1px solid var(--line)}
@page{size:A4;margin:12mm 14mm 17mm}@media print{body{background:#fff}.page{width:auto;min-height:0;padding:0;margin:0}.brand{break-inside:avoid}.doc-heading,.metadata,.party-grid,.scope-heading{break-inside:avoid}.foot{break-inside:avoid}}
`;

export const DOCUMENT_PDF_OPTIONS = {
  format: 'A4' as const,
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="font-family:Arial,sans-serif;font-size:9px;color:#75685f;width:100%;text-align:right;padding:0 16mm;box-sizing:border-box">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
};
