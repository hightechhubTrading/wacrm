// src/lib/quotations/number-to-words.ts
//
// Bilingual amount-in-words for quotation totals. The Arabic side is
// the fiddly part: cardinal numbers 3-10 take the FEMININE form when
// the counted noun (ريال, masculine) is itself masculine — Arabic
// grammar inverts gender agreement for 3-10 specifically — and
// "thousand" has three different words depending on the count: ألف
// (1), ألفان (2), آلاف (3-10, plural), then back to ألف (11+,
// singular again). Verified by hand against real example quotations
// before being written down here — see
// docs/superpowers/specs/2026-08-14-quotations-design.md.

const EN_ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const EN_TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function enChunk(num: number): string {
  let s = '';
  if (num >= 100) {
    s += EN_ONES[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  if (num >= 20) {
    s += EN_TENS[Math.floor(num / 10)] + ' ';
    num %= 10;
  }
  if (num > 0) s += EN_ONES[num] + ' ';
  return s.trim();
}

export function numberToWordsEN(n: number): string {
  if (n === 0) return 'Zero';
  let result = '';
  if (n >= 1000000) {
    result += enChunk(Math.floor(n / 1000000)) + ' Million ';
    n %= 1000000;
  }
  if (n >= 1000) {
    result += enChunk(Math.floor(n / 1000)) + ' Thousand ';
    n %= 1000;
  }
  if (n > 0) result += enChunk(n);
  return result.trim();
}

// Feminine forms — used for 3-10 because ريال is grammatically
// masculine and Arabic cardinals 3-10 agree with the OPPOSITE gender.
const AR_ONES_M = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
];
const AR_TEENS = [
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const AR_TENS = [
  '',
  '',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون',
];
const AR_HUNDREDS = [
  '',
  'مئة',
  'مئتان',
  'ثلاثمئة',
  'أربعمئة',
  'خمسمئة',
  'ستمئة',
  'سبعمئة',
  'ثمانمئة',
  'تسعمئة',
];

function arChunk(num: number): string {
  const hundreds: string[] = [];
  if (num >= 100) {
    hundreds.push(AR_HUNDREDS[Math.floor(num / 100)]);
    num %= 100;
  }

  // Tens/ones (or the teen irregular) read smallest-unit-first, e.g.
  // "ثلاثة وعشرون" = 23 -- built in reverse then joined.
  const remainder: string[] = [];
  if (num >= 10 && num < 20) {
    remainder.push(AR_TEENS[num - 10]);
  } else {
    if (num >= 20) {
      remainder.push(AR_TENS[Math.floor(num / 10)]);
    }
    if (num % 10 > 0) remainder.push(AR_ONES_M[num % 10]);
    remainder.reverse();
  }

  // Hundreds always leads when combined with a non-zero remainder --
  // "ستمئة وخمسة وخمسون" (655), not the reverse. When only one of the
  // two groups is present, this collapses to that group alone, same as
  // before.
  return [...hundreds, ...remainder].join(' و');
}

export function numberToWordsAR(n: number): string {
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  if (n >= 1000000) {
    parts.push(arChunk(Math.floor(n / 1000000)) + ' مليون');
    n %= 1000000;
  }
  if (n >= 1000) {
    const th = Math.floor(n / 1000);
    let word: string;
    if (th === 1) word = 'ألف';
    else if (th === 2) word = 'ألفان';
    else if (th <= 10) word = arChunk(th) + ' آلاف';
    else word = arChunk(th) + ' ألف';
    parts.push(word);
    n %= 1000;
  }
  if (n > 0) parts.push(arChunk(n));
  return parts.join(' و');
}

export function amountInWordsBilingual(qar: number): {
  ar: string;
  en: string;
} {
  // Keep wording equal to the two-decimal numeric total, including discounts.
  const minorUnits = Math.round((qar + Number.EPSILON) * 100);
  const whole = Math.floor(minorUnits / 100);
  const fraction = minorUnits % 100;
  const arFraction =
    fraction === 1
      ? 'درهم واحد'
      : fraction === 2
        ? 'درهمان'
        : `${numberToWordsAR(fraction)} ${fraction <= 10 ? 'دراهم' : 'درهماً'}`;
  return {
    ar: `فقط ${numberToWordsAR(whole)} ريال قطري${fraction ? ` و${arFraction}` : ''} لا غير`,
    en: `${numberToWordsEN(whole)} Qatari Riyals${fraction ? ` and ${numberToWordsEN(fraction)} Dirhams` : ''} only`,
  };
}
