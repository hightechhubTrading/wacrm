import { describe, it, expect } from 'vitest'
import {
  isolatePhoneNumbers,
  containsPriceQuestion,
  buildSystemPrompt,
  languageScript,
} from './defaults'

describe('isolatePhoneNumbers', () => {
  it('wraps a phone number embedded in Arabic (RTL) text in LRI/PDI isolate marks', () => {
    const input = 'أكيد، هذا رقم التواصل: +974 3383 1669'
    const result = isolatePhoneNumbers(input)
    expect(result).toBe('أكيد، هذا رقم التواصل: ⁦+974 3383 1669⁩')
  })

  it('leaves text with no phone number untouched', () => {
    const input = 'أكيد، هذا رقم التواصل قريباً.'
    expect(isolatePhoneNumbers(input)).toBe(input)
  })

  it('does not wrap a short digit sequence that is not phone-number-shaped', () => {
    const input = 'المدة بين 8-10 أيام'
    expect(isolatePhoneNumbers(input)).toBe(input)
  })

  it('wraps multiple phone numbers independently', () => {
    const input = 'اتصل ب +974 3383 1669 أو +974 5555 4444'
    const result = isolatePhoneNumbers(input)
    expect(result).toBe(
      'اتصل ب ⁦+974 3383 1669⁩ أو ⁦+974 5555 4444⁩',
    )
  })
})

describe('containsPriceQuestion', () => {
  it('matches an explicit Arabic price question', () => {
    expect(containsPriceQuestion('كم سعر الباب؟')).toBe(true)
    expect(containsPriceQuestion('وبخصوص التكلفة؟')).toBe(true)
  })

  it('matches the "بكام" / "يعمل كام" price idioms', () => {
    expect(containsPriceQuestion('العرض اربعة متر يعمل كام')).toBe(true)
    expect(containsPriceQuestion('الباب ده بكام؟')).toBe(true)
  })

  it('matches an explicit English price question', () => {
    expect(containsPriceQuestion('how much does it cost?')).toBe(true)
    expect(containsPriceQuestion('can I get a quote?')).toBe(true)
  })

  it('does NOT match a bare quantity question that happens to use "كام/كم"', () => {
    // The exact false-positive this was designed to avoid: "كام متر"
    // (how many meters) is a size question, not a price question, and
    // shows up constantly in the same conversations this backstop runs
    // against.
    expect(containsPriceQuestion('العرض كام متر؟')).toBe(false)
    expect(containsPriceQuestion('كم يوم يحتاج التركيب؟')).toBe(false)
  })

  it('does not match ordinary text with no price-related word at all', () => {
    expect(containsPriceQuestion('مرحبًا، شاهدت إعلان أبواب الشتر')).toBe(false)
  })

  it('matches the phrasings real customers used that used to slip past the cap', () => {
    // All from 30 days of production traffic (2026-08/09).
    expect(containsPriceQuestion('بكم تسوون الباب الأوتوماتيكي')).toBe(true)
    expect(containsPriceQuestion('إذا باب استرالي ٣.٥ في ٣ بكم')).toBe(true)
    expect(containsPriceQuestion('طيب عطني اسعارهم حاليا')).toBe(true)
    expect(containsPriceQuestion('الأسعار تبتدي من كم')).toBe(true)
    expect(containsPriceQuestion('وكم يكلف')).toBe(true)
    expect(containsPriceQuestion('كم المتر')).toBe(true)
    expect(containsPriceQuestion('1 sutter how much??')).toBe(true)
    expect(containsPriceQuestion('Can you give me quotation')).toBe(true)
  })

  it('does NOT read the courtesy "بكم" (with/to you) as a price ask', () => {
    expect(containsPriceQuestion('مستقبلا نتصل بكم ان شاء الله')).toBe(false)
    expect(containsPriceQuestion('أهلا بكم')).toBe(false)
  })

  it('does NOT match "how many"', () => {
    expect(containsPriceQuestion('How many designs you have')).toBe(false)
  })
})

describe('languageScript', () => {
  it('ignores measurements, units and product acronyms', () => {
    expect(languageScript('200 cm × 110cm')).toBe('mixed')
    expect(languageScript('3.5 m')).toBe('mixed')
    expect(languageScript('نعم، عندنا أبواب UPVC بمقاس 200×110')).toBe('arabic')
  })

  it('ignores URLs and emails so an Arabic reply carrying a link is still Arabic', () => {
    // Real reply to an English-writing customer (2026-09-20) that the old
    // check skipped as "mixed" because of the URL and email.
    expect(
      languageScript('أكيد، هذا موقعنا الرسمي: https://www.hightechub.com والإيميل: info@hightechub.com'),
    ).toBe('arabic')
  })

  it('reads real English as latin', () => {
    expect(languageScript('i want door for bathrooms and windows for villa')).toBe('latin')
  })

  it('ignores bracketed transcript markers', () => {
    expect(languageScript('[Image: A beige roller shutter.]')).toBe('mixed')
  })
})

describe('buildSystemPrompt — working hours', () => {
  it('includes the configured hours so the model never has to guess them', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      businessHours: 'Sunday 09:00-17:00; Friday closed',
      timezone: 'UTC+3',
    })
    expect(prompt).toContain('(UTC+3): Sunday 09:00-17:00; Friday closed')
  })

  it('says nothing about hours when none are configured', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(prompt).not.toContain('working hours')
  })
})

describe('buildSystemPrompt — product catalog file lines', () => {
  it('appends the AI description after the label/kind when present', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      media: [
        {
          id: 'p-1',
          name: 'Rollup Shutter door',
          description: 'Aluminum rollup shutters',
          files: [
            {
              id: 'f-1',
              label: 'front view',
              mediaKind: 'image',
              aiDescription: 'A black roller shutter, closed, motor visible at top.',
            },
          ],
        },
      ],
    })
    expect(prompt).toContain(
      '  - [f-1] front view (image): A black roller shutter, closed, motor visible at top.',
    )
  })

  it('omits the trailing colon when there is no description', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      media: [
        {
          id: 'p-1',
          name: 'Rollup Shutter door',
          description: 'Aluminum rollup shutters',
          files: [{ id: 'f-1', label: null, mediaKind: 'document', aiDescription: null }],
        },
      ],
    })
    expect(prompt).toContain('  - [f-1] (document)')
    expect(prompt).not.toContain('(document):')
  })
})
