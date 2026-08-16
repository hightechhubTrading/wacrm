import { describe, expect, it } from 'vitest';
import { numberToWordsEN, numberToWordsAR, amountInWordsBilingual } from './number-to-words';

describe('numberToWordsEN', () => {
  it('renders thousands and hundreds', () => {
    expect(numberToWordsEN(3600)).toBe('Three Thousand Six Hundred');
    expect(numberToWordsEN(35500)).toBe('Thirty Five Thousand Five Hundred');
  });
  it('renders zero', () => {
    expect(numberToWordsEN(0)).toBe('Zero');
  });
});

describe('numberToWordsAR', () => {
  it('uses the singular form for exactly one thousand', () => {
    expect(numberToWordsAR(1500)).toBe('ألف وخمسمئة');
  });
  it('uses the dual form for exactly two thousand', () => {
    expect(numberToWordsAR(2400)).toBe('ألفان وأربعمئة');
  });
  it('uses the plural form (آلاف) for 3-10 thousand', () => {
    expect(numberToWordsAR(3600)).toBe('ثلاثة آلاف وستمئة');
  });
  it('reverts to the singular form (ألف) above ten thousand', () => {
    expect(numberToWordsAR(19500)).toBe('تسعة عشر ألف وخمسمئة');
    expect(numberToWordsAR(35500)).toBe('خمسة وثلاثون ألف وخمسمئة');
  });
  it('renders a bare hundred-thousand', () => {
    expect(numberToWordsAR(100000)).toBe('مئة ألف');
  });

  // Fix 4: a chunk with BOTH a non-zero hundreds digit AND non-zero
  // tens/ones must emit hundreds FIRST, then the tens/ones portion in
  // their own (already-correct) smallest-first order -- not the whole
  // group uniformly reversed.
  it('puts hundreds before the tens/ones remainder in a mixed chunk', () => {
    expect(numberToWordsAR(655)).toBe('ستمئة وخمسة وخمسون');
    expect(numberToWordsAR(342)).toBe('ثلاثمئة واثنان وأربعون');
    expect(numberToWordsAR(999)).toBe('تسعمئة وتسعة وتسعون');
  });
  it('puts hundreds before a teen remainder in a mixed chunk', () => {
    expect(numberToWordsAR(115)).toBe('مئة وخمسة عشر');
  });
});

describe('amountInWordsBilingual', () => {
  it('wraps both languages with the currency phrase', () => {
    const { ar, en } = amountInWordsBilingual(3600);
    expect(ar).toBe('فقط ثلاثة آلاف وستمئة ريال قطري لا غير');
    expect(en).toBe('Three Thousand Six Hundred Qatari Riyals only');
  });

  // Fix 3: a percent discount on an odd subtotal produces a fractional
  // total (e.g. 10% off 1055 -> 949.5). Un-rounded, that fractional
  // value indexes the word arrays out of bounds and renders the
  // literal string "undefined" on the PDF in both languages.
  it('rounds a fractional total to the nearest whole riyal before wording it', () => {
    const a = amountInWordsBilingual(949.5);
    expect(a.ar).not.toContain('undefined');
    expect(a.en).not.toContain('undefined');
    expect(a.ar).toBe('فقط تسعمئة وخمسون ريال قطري لا غير');
    expect(a.en).toBe('Nine Hundred Fifty Qatari Riyals only');

    const b = amountInWordsBilingual(1250.5);
    expect(b.ar).not.toContain('undefined');
    expect(b.en).not.toContain('undefined');
    expect(b.ar).toBe('فقط ألف ومئتان وواحد وخمسون ريال قطري لا غير');
    expect(b.en).toBe('One Thousand Two Hundred Fifty One Qatari Riyals only');
  });
});
