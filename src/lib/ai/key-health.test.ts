import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordKeyError, clearKeyError, notifyAdminsOfKeyError } from './key-health'

/** Fake matching: ai_configs.update().eq(), profiles.select().eq().in(),
 *  notifications.insert(). Records calls for assertions. */
function fakeDb(opts: {
  admins?: { user_id: string }[] | null
  adminsError?: unknown
}): { db: SupabaseClient; updates: Array<{ table: string; values: unknown }>; inserts: unknown[] } {
  const updates: Array<{ table: string; values: unknown }> = []
  const inserts: unknown[] = []

  const db = {
    from: (table: string) => {
      if (table === 'ai_configs') {
        return {
          update: (values: unknown) => {
            updates.push({ table, values })
            return { eq: () => Promise.resolve({ data: null, error: null }) }
          },
        }
      }
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

  return { db: db as unknown as SupabaseClient, updates, inserts }
}

describe('recordKeyError', () => {
  it('sets last_key_error and last_key_error_at on ai_configs', async () => {
    const { db, updates } = fakeDb({})
    await recordKeyError(db, 'acc-1', 'invalid key')
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('ai_configs')
    expect(updates[0].values).toMatchObject({ last_key_error: 'invalid key' })
    expect((updates[0].values as { last_key_error_at: string }).last_key_error_at).toBeTruthy()
  })
})

describe('clearKeyError', () => {
  it('nulls out last_key_error and last_key_error_at', async () => {
    const { db, updates } = fakeDb({})
    await clearKeyError(db, 'acc-1')
    expect(updates[0].values).toEqual({ last_key_error: null, last_key_error_at: null })
  })
})

describe('notifyAdminsOfKeyError', () => {
  it('inserts one ai_key_invalid notification per admin+ member', async () => {
    const { db, inserts } = fakeDb({
      admins: [{ user_id: 'u-1' }, { user_id: 'u-2' }],
    })
    await notifyAdminsOfKeyError(db, 'acc-1', 'boom')
    expect(inserts).toHaveLength(2)
    expect(inserts[0]).toMatchObject({
      account_id: 'acc-1',
      user_id: 'u-1',
      type: 'ai_key_invalid',
      body: 'boom',
    })
    expect(inserts[1]).toMatchObject({ user_id: 'u-2' })
  })

  it('does nothing when there are no admin+ members', async () => {
    const { db, inserts } = fakeDb({ admins: [] })
    await notifyAdminsOfKeyError(db, 'acc-1', 'boom')
    expect(inserts).toHaveLength(0)
  })

  it('does nothing when the admin lookup errors', async () => {
    const { db, inserts } = fakeDb({ admins: null, adminsError: new Error('db down') })
    await notifyAdminsOfKeyError(db, 'acc-1', 'boom')
    expect(inserts).toHaveLength(0)
  })
})
