import { describe, it, expect } from 'vitest'
import { latestUserMessage, latestCustomerAuthoredMessage, customerLanguageScript } from './query'

describe('latestUserMessage', () => {
  it('returns the most recent user turn', () => {
    expect(
      latestUserMessage([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'latest' },
      ]),
    ).toBe('latest')
  })

  it('falls back to the last message when none are user', () => {
    expect(
      latestUserMessage([{ role: 'assistant', content: 'only assistant' }]),
    ).toBe('only assistant')
  })

  it('returns empty string for no messages', () => {
    expect(latestUserMessage([])).toBe('')
  })
})

describe('latestCustomerAuthoredMessage', () => {
  it('skips a trailing bare [Image: ...] turn (uncaptioned photo) and returns the earlier real customer text', () => {
    // The exact bug this exists to prevent: a customer writing Arabic
    // the whole conversation sends an uncaptioned photo, and its
    // always-English auto-caption must not read as the customer having
    // switched languages.
    expect(
      latestCustomerAuthoredMessage([
        { role: 'user', content: 'مرحبًا، أريد باب أوتوماتيكي' },
        { role: 'assistant', content: 'أكيد، أرسل التفاصيل' },
        { role: 'user', content: '[Image: A grey wall-mounted intercom box.]' },
      ]),
    ).toBe('مرحبًا، أريد باب أوتوماتيكي')
  })

  it('strips a trailing [Image: ...] suffix but keeps the caption when the photo WAS captioned', () => {
    expect(
      latestCustomerAuthoredMessage([
        { role: 'user', content: 'هل هذا الموتور؟\n[Image: A roller shutter motor unit.]' },
      ]),
    ).toBe('هل هذا الموتور؟')
  })

  it('returns the message unchanged when it has no image caption at all', () => {
    expect(
      latestCustomerAuthoredMessage([{ role: 'user', content: 'كم السعر؟' }]),
    ).toBe('كم السعر؟')
  })

  it('falls back to the bare image caption when the customer has never typed anything else', () => {
    expect(
      latestCustomerAuthoredMessage([
        { role: 'user', content: '[Image: A grey wall-mounted intercom box.]' },
      ]),
    ).toBe('[Image: A grey wall-mounted intercom box.]')
  })

  it('falls back to latestUserMessage behavior when there are no user messages', () => {
    expect(
      latestCustomerAuthoredMessage([{ role: 'assistant', content: 'only assistant' }]),
    ).toBe('only assistant')
  })
})

describe('customerLanguageScript', () => {
  it('skips a measurements-only turn and uses the last real words', () => {
    // Real thread (2026-09-21): an Arabic customer typed "200 cm × 110cm"
    // and the conversation flipped to English.
    expect(
      customerLanguageScript([
        { role: 'user', content: 'لباب المنزل خارجي' },
        { role: 'assistant', content: 'تمام' },
        { role: 'user', content: '200 cm × 110cm' },
      ]),
    ).toBe('arabic')
  })

  it('skips a shared location, a phone number, and a bare photo caption', () => {
    expect(
      customerLanguageScript([
        { role: 'user', content: 'I need a garage shutter' },
        { role: 'user', content: '[Location shared: https://www.google.com/maps?q=25.3,51.4]' },
        { role: 'user', content: '55808147' },
        { role: 'user', content: '[Image: A beige roller shutter.]' },
      ]),
    ).toBe('latin')
  })

  it("is 'mixed' when no customer turn carries a language signal", () => {
    expect(customerLanguageScript([{ role: 'user', content: '3.5 m' }])).toBe('mixed')
  })
})
