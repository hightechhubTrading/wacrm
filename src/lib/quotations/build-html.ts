import { areaPerItem, billableQuantity, isNonChargeable } from './totals';
import { amountInWordsBilingual } from './number-to-words';
import { QUOTATION_TEMPLATE_HTML } from './templates/quotation-html';
import { SALES_STAMP_SVG } from './sales-stamp';
import { DOCUMENT_CSS } from './document-layout';
import { customerSpecification } from './product-profile';
import { eventLabel, legacyPaymentPlan, paymentAmounts } from './payment-plan';
import type { Quotation, QuotationItem } from './types';
const fonts = (
  QUOTATION_TEMPLATE_HTML.match(/@font-face\s*\{[^}]*\}/g) ?? []
).join('\n');
const mark =
  QUOTATION_TEMPLATE_HTML.match(/<svg class="mark"[\s\S]*?<\/svg>/)?.[0] ?? '';
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const date = (s: string | null) =>
  s ? `${s.slice(8, 10)} / ${s.slice(5, 7)} / ${s.slice(0, 4)}` : '—';
const money = (n: number) =>
  esc(
    n.toLocaleString('en-QA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
const lines = (text: string | undefined) =>
  text
    ?.split('\n')
    .filter((s) => s.trim())
    .map((s) => `<li dir="auto">${esc(s)}</li>`)
    .join('') ?? '';
function itemRow(item: QuotationItem): string {
  if (item.itemType === 'section')
    return `<tr class="section-row"><td colspan="6">${esc(item.description)}</td></tr>`;
  const included = item.kind === 'Included',
    optional = item.kind === 'Optional',
    missing = item.unitPrice === null,
    unit = item.unit ?? 'piece';
  const amount = missing
    ? '<span class="draft-missing">Not priced<br>غير مسعر</span>'
    : isNonChargeable(item)
      ? '—'
      : money(item.lineTotal);
  const measure =
    item.sizeW && item.sizeH
      ? `${esc(item.sizeW)} × ${esc(item.sizeH)} ${esc(item.measurementUnit ?? 'mm')}`
      : '—';
  const quantity =
    unit === 'm2'
      ? `<span class="quantity-count">${esc(item.qty ?? 1)} opening${(item.qty ?? 1) === 1 ? '' : 's'}</span><span class="spec">${billableQuantity({ qty: item.qty ?? 1, unit, sizeW: item.sizeW ?? undefined, sizeH: item.sizeH ?? undefined, measurementUnit: item.measurementUnit ?? undefined }).toLocaleString('en', { maximumFractionDigits: 4 })} m²</span>`
      : `${esc(item.qty ?? 1)}<span class="spec">${esc(unit)}</span>`;
  return `<tr${optional ? ' class="optional"' : ''}><td class="code">${esc(item.itemCode)}</td><td><span class="it">${item.parentItemId ? '↳ ' : ''}${esc(item.description)}</span>${item.descriptionAr ? `<span class="ar" dir="rtl">${esc(item.descriptionAr)}</span>` : ''}${optional ? '<span class="spec">Optional — excluded from total · اختياري — غير مشمول في الإجمالي</span>' : ''}${included ? '<span class="spec">Included in package · مشمول في سعر المنتج</span>' : ''}${item.discountValue ? `<span class="spec">Discount · خصم: ${esc(item.discountValue)}${item.discountType === 'percent' ? '%' : ' QAR'}</span>` : ''}</td><td class="num measurement">${measure}</td><td class="num">${quantity}</td><td class="num">${included || missing ? '—' : money(item.unitPrice!)}<span class="spec">${unit === 'm2' ? 'QAR / m²' : esc(unit)}</span></td><td class="num">${amount}${optional && missing ? '<span class="spec">Price on request · السعر عند الطلب</span>' : ''}</td></tr>`;
}
export function buildQuotationHtml(
  q: Quotation,
  items: QuotationItem[],
  referenceImageData?: string
): string {
  if (
    q.documentDetails?.referenceImage &&
    (!referenceImageData ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(referenceImageData))
  )
    throw new Error('referenceImageUnavailable');
  const d = q.documentDetails ?? {},
    sorted = [...items].sort((a, b) => a.position - b.position),
    roots = sorted.filter((i) => !i.parentItemId),
    words = amountInWordsBilingual(q.total),
    revision = String(q.revision).padStart(2, '0');
  // Business date at document generation, independent of server timezone or draft age.
  const signedDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Qatar',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(new Date())
    .replaceAll('/', ' / ');
  const rows = roots
    .flatMap((item) => [
      itemRow(item),
      ...sorted
        .filter((c) => c.parentItemId === item.id && c.kind !== 'Included')
        .map(itemRow),
    ])
    .join('');
  const labels: Record<string, string> = {
    finish: 'Colour / finish · اللون / التشطيب',
    customFinish: 'Selected colour · اللون المختار',
    deliveryPeriod: 'Delivery · التسليم',
    profile: 'Slat profile · مقطع الشرائح',
    design: 'Design · التصميم',
    handle: 'Handle / lock · المقبض / القفل',
    opening: 'Opening · طريقة الفتح',
    glazing: 'Glazing · الزجاج',
  };
  const specifications = roots
    .filter((i) => i.itemType === 'line')
    .map((item) => {
      const options = d.itemOptions?.[item.id],
        facts = [
          ...(options?.drawingReference
            ? [
                [
                  'Opening / drawing · الفتحة / المخطط',
                  options.drawingReference,
                ],
              ]
            : []),
          ...Object.entries(options?.selections ?? {})
            .filter(
              ([k, v]) =>
                v.trim() &&
                !(
                  k === 'finish' &&
                  v === 'Custom' &&
                  options?.selections?.customFinish
                )
            )
            .map(([k, v]) => [labels[k] ?? k, v]),
        ];
      const specs = customerSpecification(item.specification ?? '').filter(
        (s) =>
          !/^Charged per (?:job|linear metre|metre of door width)\.?$/i.test(s)
      );
      if (item.unit === 'm2' && item.sizeW && item.sizeH) {
        const dimensions = {
          sizeW: item.sizeW,
          sizeH: item.sizeH,
          measurementUnit: item.measurementUnit ?? 'mm',
          qty: item.qty ?? 1,
          unit: 'm2',
        };
        facts.push([
          'Area · المساحة',
          `${areaPerItem(dimensions).toLocaleString('en', { maximumFractionDigits: 4 })} m² × ${item.qty ?? 1} = ${billableQuantity(dimensions).toLocaleString('en', { maximumFractionDigits: 4 })} m²`,
        ]);
      }
      const included = sorted.filter(
        (c) => c.parentItemId === item.id && c.kind === 'Included'
      );
      if (!facts.length && !specs.length && !included.length) return '';
      return `<section class="product-spec"><header><span class="mono">${esc(item.itemCode)}</span><h3>${esc(item.description)}</h3></header><div class="spec-content">${facts.length ? `<dl class="configuration-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd dir="auto">${esc(v)}</dd></div>`).join('')}</dl>` : ''}${specs.length ? `<ul>${specs.map((s) => `<li dir="auto">${esc(s)}</li>`).join('')}</ul>` : ''}${included.length ? `<div class="included-equipment"><strong>Included in package · المعدات المشمولة</strong>${included.map((c) => `<p dir="auto">${esc(c.description)}${c.descriptionAr ? ' · ' + esc(c.descriptionAr) : ''} × ${c.qty ?? 1}${c.unit === 'per_product' ? ' per product · لكل منتج' : ''}${c.specification && c.specification.replace(/[.\s]/g, '').toLowerCase() !== (c.description ?? '').replace(/[.\s]/g, '').toLowerCase() ? ' — ' + esc(c.specification) : ''}</p>`).join('')}</div>` : ''}</div></section>`;
    })
    .join('');
  const plan =
    d.paymentPlan ??
    (d.paymentSchedule ? legacyPaymentPlan(d.paymentSchedule) : undefined);
  const payments = plan
    ? `<table class="pay"><thead><tr><th>Payment event · موعد الدفع</th><th class="num">Share · النسبة</th><th class="num">Amount · المبلغ (QAR)</th></tr></thead><tbody>${plan.stages
        .filter((s) => s.percent > 0)
        .map(
          (s) =>
            `<tr><td>${s.event === 'custom' ? esc(s.label) : esc(eventLabel(s.event)) + ' · <span class="payment-ar ar">' + esc(eventLabel(s.event, true)) + '</span>'}</td><td class="num">${esc(s.percent)} %</td><td class="num">${money(paymentAmounts(plan, q.total)[plan.stages.indexOf(s)])}</td></tr>`
        )
        .join(
          ''
        )}</tbody></table>${plan.notes ? `<p class="commercial-text" dir="auto">${esc(plan.notes)}</p>` : ''}`
    : `<p class="commercial-text" dir="auto">${esc(q.paymentTerms)}</p>`;
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(q.reference)} · High Tech Hub</title><style>${fonts}\n${DOCUMENT_CSS}</style></head><body><main class="page" data-canvas-width="794">
 <header class="brand"><div class="lockup">${mark}<div><div class="nm-ar" dir="rtl">هاي تك هاب تريدينغ</div><div class="nm-en">HIGH TECH HUB TRADING</div></div></div><div class="contact">Office 6, Building 33, Street 180, Zone 55, Al Azizia, Doha<br>+974 5064 0111 · info@hightechub.com</div></header>
 <div class="doc-heading"><h1>QUOTATION<span class="ar">عرض سعر</span></h1><div class="doc-reference">${esc(q.reference)}</div></div>
 <div class="metadata"><div><div class="ref-k">DATE</div>\n        <div class="ref-v">${date(q.createdAt)}</div></div><div><div class="ref-k">VALID UNTIL · صالح حتى</div><div class="ref-v">${date(q.validUntil)}</div></div><div><div class="ref-k">REVISION · المراجعة</div><div class="ref-v">${revision}</div></div></div>
 <div class="party-grid"><section><p class="party-title">PREPARED FOR · مقدم إلى</p><div class="party-name">${esc(q.clientCompany || q.clientName)}</div><dl>${q.clientCompany && q.clientName && q.clientName !== q.clientCompany ? `<dt>Attention</dt><dd>${esc(q.clientName)}</dd>` : ''}${q.clientPhone ? `<dt>Contact</dt><dd dir="ltr">${esc(q.clientPhone)}</dd>` : ''}</dl></section><section><p class="party-title">PROJECT · المشروع</p><div class="party-name">${esc(q.projectName)}</div><dl>${q.location ? `<dt>Location</dt><dd>${esc(q.location)}</dd>` : ''}${d.consultant ? `<dt>Consultant</dt><dd>${esc(d.consultant)}</dd>` : ''}</dl></section></div>
 <section class="scope-heading"><h2>Scope of supply <span class="ar">نطاق التوريد</span></h2><p dir="auto">${esc(q.subject)}</p>${d.subjectAr ? `<p class="ar">${esc(d.subjectAr)}</p>` : ''}</section>
 <table class="items"><colgroup><col style="width:9%"><col style="width:35%"><col style="width:18%"><col style="width:10%"><col style="width:14%"><col style="width:14%"></colgroup><thead><tr><th>ITEM<small>البند</small></th><th>PRODUCT / SERVICE<small>المنتج / الخدمة</small></th><th class="num">SIZE W × H<small>الأبعاد</small></th><th class="num">QTY<small>الكمية</small></th><th class="num">RATE (QAR)<small>سعر الوحدة</small></th><th class="num">AMOUNT (QAR)<small>المبلغ</small></th></tr></thead><tbody>${rows}</tbody></table>
 <div class="totals-wrap"><div class="amount-words"><p>${esc(words.en)}</p><p class="ar">${esc(words.ar)}</p></div><div class="totals">${q.discountAmount ? `<div><span>Subtotal · المجموع</span><span>${money(q.subtotal)}</span></div><div><span>Discount · الخصم</span><span>−${money(q.discountAmount)}</span></div>` : ''}<div class="grand-total"><span>Total · الإجمالي</span><span>${money(q.total)} <small>QAR</small></span></div></div></div>
 ${d.referenceImage ? `<section class="reference-image"><h2>Reference image <span class="ar">صورة مرجعية</span></h2><img src="${referenceImageData}" width="${d.referenceImage.width}" height="${d.referenceImage.height}" alt="Reference image · صورة مرجعية"></section>` : ''}
 ${specifications ? `<section class="specifications"><h2>Selected specifications <span class="ar">المواصفات المختارة</span></h2>${specifications}</section>` : ''}
 <section class="commercial"><h2>Scope boundaries <span class="ar">حدود نطاق العمل</span></h2><div class="scope-grid"><section><h3>Included · مشمول</h3><ul>${lines(d.included)}</ul></section><section><h3>Excluded · غير مشمول</h3><ul>${lines(d.excluded)}</ul></section></div>
 <h2>Payment schedule <span class="ar">جدول الدفعات</span></h2>${payments}
 <dl class="terms"><div><dt>Delivery / installation · التسليم / التركيب</dt><dd dir="auto">${esc(q.deliveryTerms?.replace(/^Delivery\s*(?:\/\s*installation)?:\s*/i, ''))}</dd></div>${q.warrantyTerms ? `<div><dt>Warranty · الضمان</dt><dd dir="auto">${esc(q.warrantyTerms?.replace(/^Warranty:\s*/i, ''))}</dd></div>` : ''}${d.shopDrawingDays !== undefined ? `<div><dt>Shop drawings · المخططات التنفيذية</dt><dd>${esc(d.shopDrawingDays)} working days · أيام عمل</dd></div>` : ''}<div><dt>Currency · العملة</dt><dd>Qatari Riyals (QAR) · الريال القطري</dd></div></dl>
 ${d.notes ? `<h2>Notes <span class="ar">ملاحظات</span></h2><p class="commercial-text" dir="auto">${esc(d.notes)}</p>` : ''}
 <section class="sales-signoff"><h2>For High Tech Hub Trading <span class="ar">عن هاي تك هاب تريدينغ</span></h2><div class="sigs"><div class="sig"><div class="sig-value sales-name" dir="auto">${esc(d.preparedBy?.trim() || '—')}</div><div>SALES REPRESENTATIVE · ممثل المبيعات</div>${d.repPhone ? `<div class="sales-phone">${esc(d.repPhone)}</div>` : ''}</div><div class="sig"><div class="sig-value stamp-slot">${SALES_STAMP_SVG}</div><div>SALES STAMP · ختم المبيعات</div></div><div class="sig"><div class="sig-value signed-date">${signedDate}</div><div>DATE · التاريخ</div></div></div></section></section>
 <footer class="foot">Prepared by ${esc(d.preparedBy)}${d.repPhone ? ' · ' + esc(d.repPhone) : ''} · ${esc(q.reference)} · ${date(q.createdAt)} &nbsp;·&nbsp; REV ${revision}</footer></main></body></html>`;
}
