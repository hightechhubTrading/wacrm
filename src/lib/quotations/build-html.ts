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
//
// A second hazard, independent of the first: wherever a replacement is
// passed to .replace()/.replaceAll() as a STRING (not a function), JS
// treats `$1`, `$&`, `` $` ``, `$'`, `$$` in that string as special
// substitution patterns — even when the search side is a plain string, not
// a regex. Free-text CRM fields (company names, project names, item
// descriptions) can contain a literal "$" followed by a digit or "&" with
// no adversarial intent, and it would get silently reinterpreted instead
// of inserted verbatim (`$&` in particular re-inserts the entire matched,
// still-unfilled placeholder — i.e. it reintroduces the exact "leftover
// placeholder" bug the tests below exist to catch). Every replacement
// below that inserts variable content therefore uses a replacer FUNCTION,
// whose return value is never re-scanned for `$`-patterns. Plain strings
// are only used where the replacement is 100% static (no interpolation).
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
// keeps each field aimed at its own row. Uses a replacer function (see
// file header) so a "$"-containing value can never be reinterpreted.
function fillPartyField(html: string, label: string, value: string | null): string {
  const re = new RegExp(`(<dt>${label}</dt><dd(?:[^>]*)>)________________(</dd>)`);
  return html.replace(re, (_match, open: string, close: string) => `${open}${esc(value ?? '')}${close}`);
}

export function buildQuotationHtml(quotation: Quotation, items: QuotationItem[]): string {
  let html = readFileSync(TEMPLATE_PATH, 'utf8');
  const words = amountInWordsBilingual(quotation.total);
  const revision = String(quotation.revision).padStart(2, '0');

  // Reference — appears TWICE (page 1 header, page 2 continuation header),
  // each wrapped in a "todo" (amber, "unresolved") flagging class that
  // must not survive once real data fills the slot. Strip the class first
  // (both are static, non-interpolated replacements) — the reference text
  // itself is filled a few lines down, once, via replaceAll.
  html = html.replace('class="ref-v todo"', 'class="ref-v"');
  html = html.replace('<span class="todo">HT-__-___-___</span>', '<span>HT-__-___-___</span>');
  // A single non-global .replace() here would silently leave page 2's copy
  // as the literal placeholder — replaceAll is required. Function form:
  // quotation.reference is free text and could in principle contain "$".
  html = html.replaceAll('HT-__-___-___', () => quotation.reference);

  // Revision — "00" alone is far too generic to blind-replace, so it's
  // anchored to its label on page 1, and to the literal "REV 00" run in
  // page 2's continuation header (the only place that exact pair occurs).
  html = html.replace(
    /(<div class="ref-k">REV<\/div>\s*<div class="ref-v">)00(<\/div>)/,
    (_match, open: string, close: string) => `${open}${revision}${close}`
  );
  html = html.replace(/REV 00/, () => `REV ${revision}`);

  // Valid-until date — data exists on Quotation, fill it.
  const validUntil = formatDateDMY(quotation.validUntil);
  if (validUntil) {
    html = html.replace(
      /(<div class="ref-k">VALID UNTIL<\/div>\s*<div class="ref-v gold">)__ \/ __ \/ ____(<\/div>)/,
      (_match, open: string, close: string) => `${open}${validUntil}${close}`
    );
  }
  // Issue date — Quotation.createdAt (added in final-review fix wave 1
  // specifically so this gap could close; previously there was no data to
  // fill it with, see task-8-report.md). createdAt is a full ISO
  // timestamp (e.g. "2026-03-01T10:00:00Z"); formatDateDMY expects a bare
  // "YYYY-MM-DD" date, so the time component is dropped first. Formatted
  // DD / MM / YYYY to match validUntil's existing display convention just
  // above — this is a Qatari business document, so day-month-year reads
  // naturally here (unlike a US month-day-year default).
  const issueDate = formatDateDMY(quotation.createdAt.slice(0, 10));
  if (issueDate) {
    html = html.replace(
      /(<div class="ref-k">DATE<\/div>\s*<div class="ref-v">)__ \/ __ \/ ____(<\/div>)/,
      (_match, open: string, close: string) => `${open}${issueDate}${close}`
    );
    // Page 2's continuation header repeats the issue date next to REV, as
    // plain inline text with no wrapping element to anchor on — anchored
    // instead to the literal " · REV" that immediately follows it, so this
    // can't accidentally match page 1's VALID UNTIL date (already consumed
    // above, and structurally distinct — wrapped in its own gold-classed
    // div) or REV's own "00"/revision text.
    html = html.replace(
      /__ \/ __ \/ ____( &nbsp;·&nbsp; REV)/,
      (_match, suffix: string) => `${issueDate}${suffix}`
    );
  }

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
    () => `Supply and installation of ${esc(quotation.subject ?? '')}`
  );
  html = html.replace('توريد وتركيب ________________', 'توريد وتركيب');

  // Items table. The vendored template ships 6 sample rows (D01–D06) plus
  // a "SECTION A — ________________" group header as filler content. The
  // brief's original approach regex-matched and replaced only the D01 row,
  // which would have left D02–D06 and the section header as literal
  // placeholders in every real quotation — replace the whole <tbody>
  // instead, scoped to the items table specifically (the payment-schedule
  // table on page 2 has its own <tbody> and must not be touched). Item
  // descriptions are free text and could contain "$" — replacer function.
  const rows = items.map(itemRowHtml).join('');
  html = html.replace(
    /(<table class="items">[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/,
    (_match, open: string, close: string) => `${open}${rows}\n    ${close}`
  );

  // Total in words. The template wraps its own placeholder in a fixed
  // فقط / لا غير (Arabic) and "Qatari Riyals only" (English) shell;
  // amountInWordsBilingual already returns that full shell, so the whole
  // fixed phrase is replaced wholesale rather than just the inner
  // placeholder — otherwise the wrapper words would double up.
  html = html.replace(/________________ Qatari Riyals only/, () => esc(words.en));
  html = html.replace(/فقط ________________ ريالاً قطرياً لا غير/, () => esc(words.ar));
  html = html.replace(
    /(<div class="total-f">)—(<small>QAR<\/small><\/div>)/,
    (_match, open: string, close: string) => `${open}${quotation.total.toLocaleString()}${close}`
  );

  // Decorative placeholders with no corresponding data field on Quotation
  // — dropped rather than filled with invented text (all static, no
  // interpolation, so plain-string replace is fine here).
  html = html.replace('<li>________________</li>', '');
  html = html.replace('Prepared by ________________', 'Prepared by');

  // Payment-schedule share percentages (3 identical rows: advance,
  // pre-installation, completion) and the delivery/shop-drawing lead-time
  // figures (Terms row + "What happens next", English and Arabic) have no
  // corresponding field on Quotation/QuotationItem either. Same treatment:
  // cleared, not fabricated, and — because these carry the "todo" amber
  // flagging class — the class is stripped too, so the cleared cell ships
  // with neither the raw placeholder text nor the "still needs input"
  // styling. Static replacements throughout; no user data involved.
  html = html.replace(/class="n pct todo">__ %</g, 'class="n pct"><');
  html = html.replaceAll('<span class="todo">__</span>', '<span></span>');

  return html;
}
