import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildHandoffSummary, notifyAiHandoff } from './handoff'

describe('buildHandoffSummary', () => {
  it('notes the reply count and quotes the last customer message', () => {
    const summary = buildHandoffSummary({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'I want a refund' },
      ],
      replyCount: 2,
    })
    expect(summary).toBe(
      '🤖 AI agent handed off after 2 replies. Last customer message: “I want a refund”',
    )
  })

  it('uses the singular "reply" for a count of one', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: 'help' }],
      replyCount: 1,
    })
    expect(summary).toContain('after 1 reply.')
  })

  it('says "without replying" when the bot bailed on the first inbound', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: 'agent please' }],
      replyCount: 0,
    })
    expect(summary).toContain('handed off without replying.')
    expect(summary).toContain('“agent please”')
  })

  it('picks the most recent customer turn, ignoring assistant turns', () => {
    const summary = buildHandoffSummary({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'a reply' },
      ],
      replyCount: 1,
    })
    expect(summary).toContain('“second”')
  })

  it('collapses whitespace and truncates a long message', () => {
    const long = 'x'.repeat(300)
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: long }],
      replyCount: 0,
    })
    expect(summary).toContain('…')
    // 160-char cap on the quote; the whole note stays well under 250.
    expect(summary.length).toBeLessThan(250)
  })

  it('degrades gracefully when there is no customer message', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'assistant', content: 'greeting' }],
      replyCount: 0,
    })
    expect(summary).toBe('🤖 AI agent handed off without replying.')
  })
})

function fakeDb(opts: {
  admins?: { user_id: string }[] | null
  adminsError?: unknown
}): { db: SupabaseClient; inserts: unknown[] } {
  const inserts: unknown[] = []

  const db = {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: opts.admins ?? null,
                  error: opts.adminsError ?? null,
                }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return {
          insert: (rows: unknown[]) => {
            inserts.push(...rows)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { db: db as unknown as SupabaseClient, inserts }
}

describe('notifyAiHandoff', () => {
  it('notifies only the assigned agent when one is set, with the handoff summary as the body', async () => {
    const { db, inserts } = fakeDb({})
    await notifyAiHandoff(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: 'agent-1',
      summary: '🤖 AI agent handed off after 2 replies. Last customer message: “price please”',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      account_id: 'acc-1',
      user_id: 'agent-1',
      type: 'ai_handoff',
      conversation_id: 'conv-1',
      contact_id: 'contact-1',
      title: 'AI assistant handed off a conversation',
      body: '🤖 AI agent handed off after 2 replies. Last customer message: “price please”',
    })
  })

  it('notifies every admin+ member when no agent is assigned', async () => {
    const { db, inserts } = fakeDb({
      admins: [{ user_id: 'admin-1' }, { user_id: 'admin-2' }],
    })
    await notifyAiHandoff(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: null,
      summary: 'no one is handling this',
    })
    expect(inserts).toHaveLength(2)
    expect(inserts.map((r) => (r as { user_id: string }).user_id)).toEqual([
      'admin-1',
      'admin-2',
    ])
  })

  it('does nothing when unassigned and there are no admins', async () => {
    const { db, inserts } = fakeDb({ admins: [] })
    await notifyAiHandoff(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: null,
      summary: 'x',
    })
    expect(inserts).toHaveLength(0)
  })

  it('does nothing when the admin lookup errors', async () => {
    const { db, inserts } = fakeDb({ admins: null, adminsError: new Error('db down') })
    await notifyAiHandoff(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: null,
      summary: 'x',
    })
    expect(inserts).toHaveLength(0)
  })
})
