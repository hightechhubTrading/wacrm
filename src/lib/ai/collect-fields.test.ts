import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listAiCollectibleFields,
  applyCollectedFields,
} from './collect-fields'

describe('listAiCollectibleFields', () => {
  it('filters by account_id, ai_collectible, and group_id IS NULL', async () => {
    const calls: { fn: string; args: unknown[] }[] = []
    const chain = {
      from: (...args: unknown[]) => {
        calls.push({ fn: 'from', args })
        return chain
      },
      select: (...args: unknown[]) => {
        calls.push({ fn: 'select', args })
        return chain
      },
      eq: (...args: unknown[]) => {
        calls.push({ fn: 'eq', args })
        return chain
      },
      is: (...args: unknown[]) => {
        calls.push({ fn: 'is', args })
        return chain
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({
          data: [{ id: 'f-1', field_name: 'Measurements / Dimensions' }],
          error: null,
        }),
    }
    const db = chain as unknown as SupabaseClient

    const result = await listAiCollectibleFields(db, 'acc-1')

    expect(result).toEqual([
      { id: 'f-1', name: 'Measurements / Dimensions', scope: 'contact' },
    ])
    // Regression guard: a group-scoped field must never surface here,
    // which requires the query to filter group_id IS NULL, not just
    // ai_collectible = true.
    expect(calls).toContainEqual({ fn: 'is', args: ['group_id', null] })
    expect(calls).toContainEqual({ fn: 'eq', args: ['ai_collectible', true] })
  })

  it('returns [] on a query error', async () => {
    const chain = {
      from: () => chain,
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: null, error: new Error('boom') }),
    }
    const db = chain as unknown as SupabaseClient
    expect(await listAiCollectibleFields(db, 'acc-1')).toEqual([])
  })
})

describe('applyCollectedFields — group-scoped field routing', () => {
  it('writes a group-scoped field (e.g. "Product") to deal_custom_values, never contact_custom_values, even though it is ai_collectible', async () => {
    const upserts: { table: string; payload: unknown; onConflict: string }[] = []

    const db = {
      from: (table: string) => {
        if (table === 'deals') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: { id: 'deal-1', stage_id: 'stage-1', notes: null },
                            error: null,
                          }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }
        }
        if (table === 'custom_fields') {
          // Used twice: listAiCollectibleFields (ai_collectible + group_id
          // IS NULL -- correctly returns nothing, "Product" belongs to a
          // group) and listGroupFieldsForStage's field lookup by group_id
          // (returns "Product" as deal-scoped).
          return {
            select: (cols: string) => {
              if (cols === 'id, field_name') {
                return {
                  eq: () => ({
                    eq: () => ({
                      is: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }
              }
              return {
                in: () =>
                  Promise.resolve({
                    data: [{ id: 'field-product', field_name: 'Product', group_id: 'group-1' }],
                    error: null,
                  }),
              }
            },
          }
        }
        if (table === 'stage_required_groups') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      group_id: 'group-1',
                      custom_field_groups: { scope: 'deal', is_active: true },
                    },
                  ],
                  error: null,
                }),
            }),
          }
        }
        if (table === 'deal_custom_values' || table === 'contact_custom_values') {
          return {
            upsert: (payload: unknown, opts: { onConflict: string }) => {
              upserts.push({ table, payload, onConflict: opts.onConflict })
              return Promise.resolve({ data: null, error: null })
            },
          }
        }
        throw new Error(`unexpected table in test: ${table}`)
      },
    } as unknown as SupabaseClient

    await applyCollectedFields({
      db,
      accountId: 'acc-1',
      contactId: 'contact-1',
      fields: [{ name: 'Product', value: 'نافذة زجاج' }],
    })

    expect(upserts).toHaveLength(1)
    expect(upserts[0].table).toBe('deal_custom_values')
    expect(upserts[0].payload).toEqual({
      deal_id: 'deal-1',
      custom_field_id: 'field-product',
      value: 'نافذة زجاج',
    })
  })
})
