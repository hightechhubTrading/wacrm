// Client-safe constants/types for CTWA conversion tagging. No server
// imports here: the inbox UI and the report page import this module.

export const CONVERSION_STAGES = ['qualified', 'site_visit', 'won'] as const
export type ConversionStage = (typeof CONVERSION_STAGES)[number]

export type ConversionStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped_no_clid'

export function isConversionStage(value: unknown): value is ConversionStage {
  return typeof value === 'string' && (CONVERSION_STAGES as readonly string[]).includes(value)
}

/** A `conversion_events` row as returned by PostgREST. */
export interface ConversionEventRow {
  id: string
  account_id: string
  conversation_id: string
  attribution_id: string | null
  deal_id: string | null
  stage: ConversionStage
  meta_event_name: string
  event_id: string
  value: number | string | null
  currency: string | null
  status: ConversionStatus
  attempts: number
  next_attempt_at: string
  last_attempt_at: string | null
  last_error: string | null
  meta_response: Record<string, unknown> | null
  tagged_by: string | null
  tagged_at: string
  sent_at: string | null
  undone_at: string | null
}
