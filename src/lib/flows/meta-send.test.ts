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

import {
  engineSendText,
  engineSendMedia,
  engineSendInteractiveButtons,
} from './meta-send'

const OPTED_OUT_CONTACT = { id: 'c1', phone: '+14155550123', opted_out: true }

describe('flows meta-send — opt-out gate', () => {
  it('engineSendText throws when the contact opted out', async () => {
    h.contact = OPTED_OUT_CONTACT
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

  it('engineSendMedia throws when the contact opted out', async () => {
    h.contact = OPTED_OUT_CONTACT
    await expect(
      engineSendMedia({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'c1',
        kind: 'image',
        link: 'https://example.com/image.png',
      }),
    ).rejects.toThrow(/opted out/)
  })

  it('engineSendInteractiveButtons throws when the contact opted out', async () => {
    h.contact = OPTED_OUT_CONTACT
    await expect(
      engineSendInteractiveButtons({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'c1',
        bodyText: 'Pick one',
        buttons: [{ id: 'a', title: 'A' }],
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
    ).rejects.not.toThrow(/opted out/)
  })
})
