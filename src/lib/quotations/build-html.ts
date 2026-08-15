// src/lib/quotations/build-html.ts
//
// Pure string-in/string-out HTML filler for the branded quotation template.
// No browser, no PDF rendering — that is Task 9's job, kept separate so
// this data-substitution logic stays unit-testable without Playwright.
//
// IMPORTANT: this file's .replace() calls target LITERAL strings/patterns
// that are assumed to exist verbatim in templates/quotation.html.
// .replace() on a non-matching string is a silent no-op in JavaScript — it
// will not throw, it will just leave the placeholder in the output. If the
// vendored template is ever re-synced from the source repo, re-diff it
// against this file before trusting a green test run: the fixture used by
// build-html.test.ts only exercises one item and mostly-null party fields,
// so it will not by itself catch every possible placeholder regression.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { amountInWordsBilingual } from './number-to-words';
import type { Quotation, QuotationItem } from './types';

// Vendored, not read from the sibling repo — see Task 8's pre-flight note.
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'quotation.html');

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Template dates read "__ / __ / ____" (DD / MM / YYYY). Quotation stores
// ISO (YYYY-MM-DD).
function formatDateDMY(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return null;
  return `${d} / ${m} / ${y}`;
}

function itemRowHtml(item: QuotationItem): string {
  if (item.itemType === 'section') {
    return `\n      <tr class="grp"><td colspan="6">${esc(item.description ?? '')}</td></tr>`;
  }
  const size = item.sizeW != null && item.sizeH != null ? `${item.sizeW} × ${item.sizeH}` : '— × —';
  return `
      <tr>
        <td class="code">${esc(item.itemCode ?? '')}</td>
        <td><span class="it">${esc(item.description ?? '')}</span></td>
        <td class="n num">${size}</td>
        <td class="n num">${item.qty ?? 1}</td>
        <td class="n num">${(item.unitPrice ?? 0).toLocaleString()}</td>
        <td class="n num">${item.lineTotal.toLocaleString()}</td>
      </tr>`;
}

// Anchors a <dt>label</dt><dd>...</dd> pair and fills the dd's placeholder
// text. A bare `.replace('________________', value)` would only ever hit
// the FIRST of the ~19 identical placeholder runs in the template — this
// keeps each field aimed at its own row.
function fillPartyField(html: string, label: string, value: string | null): string {
  const re = new RegExp(`(<dt>${label}</dt><dd(?:[^>]*)>)________________(</dd>)`);
  return html.replace(re, `$1${esc(value ?? '')}$2`);
}

export function buildQuotationHtml(quotation: Quotation, items: QuotationItem[]): string {
  let html = readFileSync(TEMPLATE_PATH, 'utf8');
  const words = amountInWordsBilingual(quotation.total);
  const revision = String(quotation.revision).padStart(2, '0');

  // Reference — appears TWICE (page 1 header, page 2 continuation header).
  // A single non-global .replace() here would silently leave page 2's copy
  // as the literal placeholder — replaceAll is required.
  html = html.replaceAll('HT-__-___-___', quotation.reference);

  // Revision — "00" alone is far too generic to blind-replace, so it's
  // anchored to its label on page 1, and to the literal "REV 00" run in
  // page 2's continuation header (the only place that exact pair occurs).
  html = html.replace(
    /(<div class="ref-k">REV<\/div>\s*<div class="ref-v">)00(<\/div>)/,
    `$1${revision}$2`
  );
  html = html.replace(/REV 00/, `REV ${revision}`);

  // Valid-until date — data exists on Quotation, fill it.
  const validUntil = formatDateDMY(quotation.validUntil);
  if (validUntil) {
    html = html.replace(
      /(<div class="ref-k">VALID UNTIL<\/div>\s*<div class="ref-v gold">)__ \/ __ \/ ____(<\/div>)/,
      `$1${validUntil}$2`
    );
  }
  // NOTE: the template's "DATE" field (issue date) is intentionally left
  // as "__ / __ / ____" — Quotation has no createdAt/issuedAt field to
  // source it from. See task-8-report.md.

  // Party / project block.
  html = fillPartyField(html, 'Company', quotation.clientCompany);
  html = fillPartyField(html, 'Attention', quotation.clientName);
  html = fillPartyField(html, 'Contact', quotation.clientPhone);
  html = fillPartyField(html, 'Project', quotation.projectName);
  html = fillPartyField(html, 'Location', quotation.location);
  // No "consultant" field on Quotation — cleared, not fabricated.
  html = fillPartyField(html, 'Consultant', null);

  // Subject (English). Arabic subject has no source field — see report;
  // cleared rather than machine-translated (non-negotiable in this repo's
  // sibling project's CLAUDE.md, and good practice regardless).
  html = html.replace(
    'Supply and installation of ________________',
    `Supply and installation of ${esc(quotation.subject ?? '')}`
  );
  html = html.replace('توريد وتركيب ________________', 'توريد وتركيب');

  // Items table. The vendored template ships 6 sample rows (D01–D06) plus
  // a "SECTION A — ________________" group header as filler content. The
  // brief's original approach regex-matched and replaced only the D01 row,
  // which would have left D02–D06 and the section header as literal
  // placeholders in every real quotation — replace the whole <tbody>
  // instead, scoped to the items table specifically (the payment-schedule
  // table on page 2 has its own <tbody> and must not be touched).
  const rows = items.map(itemRowHtml).join('');
  html = html.replace(
    /(<table class="items">[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/,
    `$1${rows}\n    $2`
  );

  // Total in words. The template wraps its own placeholder in a fixed
  // فقط / لا غير (Arabic) and "Qatari Riyals only" (English) shell;
  // amountInWordsBilingual already returns that full shell, so the whole
  // fixed phrase is replaced wholesale rather than just the inner
  // placeholder — otherwise the wrapper words would double up.
  html = html.replace(/________________ Qatari Riyals only/, esc(words.en));
  html = html.replace(/فقط ________________ ريالاً قطرياً لا غير/, esc(words.ar));
  html = html.replace(
    /(<div class="total-f">)—(<small>QAR<\/small><\/div>)/,
    `$1${quotation.total.toLocaleString()}$2`
  );

  // Decorative placeholders with no corresponding data field on Quotation
  // — dropped rather than filled with invented text.
  html = html.replace('<li>________________</li>', '');
  html = html.replace('Prepared by ________________', 'Prepared by');

  return html;
}
