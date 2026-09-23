import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().in().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('falls back to transcript for a transcribed voice note', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: null, transcript: 'voice note text' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'voice note text' }])
  })

  it('drops an untranscribed audio message (no content_text, no transcript)', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_text: null, transcript: null }]),
      'conv-1',
    )
    expect(out).toEqual([])
  })

  it('wraps a standalone image_description (uncaptioned photo) in an [Image: ...] marker', async () => {
    // Unwrapped, this would read exactly like the customer's own words
    // and derail reply-language matching -- see buildSystemPrompt's
    // `[Image: ...]` guidance in defaults.ts.
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_text: null,
          transcript: null,
          image_description: 'a grey sofa',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[Image: a grey sofa]' }])
  })

  it('combines a caption and an image description on the same message', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_text: 'is this in stock?',
          transcript: null,
          image_description: 'a grey sofa',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: 'is this in stock?\n[Image: a grey sofa]' },
    ])
  })

  it('drops an unanalyzed photo (no content_text, no image_description)', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: null, image_description: null },
      ]),
      'conv-1',
    )
    expect(out).toEqual([])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })
})

describe('buildConversationContext — non-text messages', () => {
  it('shows a shared location so the model stops asking for it', async () => {
    // Real thread (2026-09-10): the customer shared their location twice
    // and was asked for "the area or location" three more times.
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'location',
          content_text: 'https://www.google.com/maps?q=25.33,51.39',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[Location shared: https://www.google.com/maps?q=25.33,51.39]' },
    ])
  })

  it('marks files and videos instead of dropping them', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'video', content_text: null },
        { sender_type: 'customer', content_type: 'document', content_text: 'Binder1.pdf' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[File sent: Binder1.pdf]' },
      { role: 'user', content: '[Video sent]' },
    ])
  })

  it("records the business's own outbound photo so the model knows it already went out", async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_type: 'image', content_text: null }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: '[Photo sent]' }])
  })

  it('keeps an undescribed customer photo visible instead of dropping it', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'image', content_text: null, image_description: null },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[Image: no description available]' }])
  })

  it('drops the "unsupported" placeholder once photos follow it (a WhatsApp album)', async () => {
    // Real thread (2026-09-10): the model kept asking the customer to
    // resend photos it had already received and described -- they gave
    // up on a 5-door order ("Forget it").
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'image',
          content_text: null,
          image_description: 'The exterior of a new shop.',
        },
        {
          sender_type: 'customer',
          content_type: 'text',
          content_text: '[Unsupported message type: unsupported]',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[Image: The exterior of a new shop.]' }])
  })

  it('keeps the "unsupported" placeholder when nothing follows it', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'text',
          content_text: '[Unsupported message type: unsupported]',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[Unsupported message type: unsupported]' }])
  })
})
