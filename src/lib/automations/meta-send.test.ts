import { describe, it, expect, vi } from 'vitest'

// Only the contact lookup matters here — the opt-out gate throws right
// after it, before whatsapp_config is ever loaded or Meta is called.
const h = vi.hoisted(() => ({
  contact: null as { id: string; phone: string; opted_out?: boolean } | null,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve(
            table === 'contacts'
              ? { data: h.contact, error: null }
              : { data: null, error: null },
          ),
      }
      return b
    },
  }),
}))

import { engineSendText } from './meta-send'

describe('engineSendText — opt-out gate', () => {
  it('throws before attempting a send when the contact opted out', async () => {
    h.contact = { id: 'c1', phone: '+14155550123', opted_out: true }
    await expect(
      engineSendText({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'c1',
        text: 'hello',
      }),
    ).rejects.toThrow(/opted out/)
  })

  it('does not throw the opt-out error for a non-opted-out contact', async () => {
    h.contact = { id: 'c1', phone: '+14155550123', opted_out: false }
    await expect(
      engineSendText({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'c1',
        text: 'hello',
      }),
      // It'll still fail later (no whatsapp_config mocked) — we only
      // assert it gets PAST the opt-out gate.
    ).rejects.not.toThrow(/opted out/)
  })
})
