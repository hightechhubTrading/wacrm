import { describe, it, expect } from 'vitest'
import { isolatePhoneNumbers } from './defaults'

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
