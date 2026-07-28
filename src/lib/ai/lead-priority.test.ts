import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyUrgentLead } from './lead-priority'

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

describe('notifyUrgentLead', () => {
  it('notifies only the assigned agent when one is set', async () => {
    const { db, inserts } = fakeDb({ admins: [{ user_id: 'admin-1' }] })
    await notifyUrgentLead(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: 'agent-1',
      reason: 'customer is furious',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      account_id: 'acc-1',
      user_id: 'agent-1',
      type: 'urgent_lead',
      conversation_id: 'conv-1',
      contact_id: 'contact-1',
      body: 'customer is furious',
    })
  })

  it('falls back to a default body when no reason is given', async () => {
    const { db, inserts } = fakeDb({})
    await notifyUrgentLead(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: 'agent-1',
      reason: null,
    })
    expect(inserts[0]).toMatchObject({ body: 'AI flagged this conversation as urgent.' })
  })

  it('notifies every admin+ member when unassigned', async () => {
    const { db, inserts } = fakeDb({
      admins: [{ user_id: 'admin-1' }, { user_id: 'admin-2' }],
    })
    await notifyUrgentLead(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: null,
      reason: 'no one is handling this',
    })
    expect(inserts).toHaveLength(2)
    expect(inserts.map((r) => (r as { user_id: string }).user_id)).toEqual([
      'admin-1',
      'admin-2',
    ])
  })

  it('does nothing when unassigned and there are no admins', async () => {
    const { db, inserts } = fakeDb({ admins: [] })
    await notifyUrgentLead(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: null,
      reason: 'x',
    })
    expect(inserts).toHaveLength(0)
  })

  it('does nothing when the admin lookup errors', async () => {
    const { db, inserts } = fakeDb({ admins: null, adminsError: new Error('db down') })
    await notifyUrgentLead(db, {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      assignedAgentId: null,
      reason: 'x',
    })
    expect(inserts).toHaveLength(0)
  })
})
