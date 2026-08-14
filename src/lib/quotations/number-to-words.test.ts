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
});

describe('amountInWordsBilingual', () => {
  it('wraps both languages with the currency phrase', () => {
    const { ar, en } = amountInWordsBilingual(3600);
    expect(ar).toBe('فقط ثلاثة آلاف وستمئة ريال قطري لا غير');
    expect(en).toBe('Three Thousand Six Hundred Qatari Riyals only');
  });
});
