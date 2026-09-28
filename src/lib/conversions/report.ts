import type { ConversionStage } from './stages'

// Pure, client-safe per-ad aggregation for the /ad-conversions page.

export interface AttributionForReport {
  conversation_id: string
  ad_id: string | null
  headline: string | null
  clicked_at: string
}

export interface EventForReport {
  conversation_id: string
  stage: ConversionStage
  value: number | string | null
  undone_at: string | null
}

export interface AdReportRow {
  ad_id: string
  headline: string
  conversations: number
  qualified: number
  site_visit: number
  won: number
  won_value: number
  qualified_rate: number
}

export interface FailedSend {
  id: string
  conversation_id: string
  stage: ConversionStage
  attempts: number
  last_error: string | null
  last_attempt_at: string | null
}

/** Each conversation counts once, under its most recent ad click. */
export function buildAdReport(attrs: AttributionForReport[], events: EventForReport[]): AdReportRow[] {
  const latest = new Map<string, AttributionForReport>()
  for (const a of attrs) {
    const current = latest.get(a.conversation_id)
    if (!current || Date.parse(a.clicked_at) > Date.parse(current.clicked_at)) latest.set(a.conversation_id, a)
  }

  const rows = new Map<string, AdReportRow>()
  for (const a of latest.values()) {
    const key = a.ad_id ?? 'unknown'
    const row = rows.get(key) ?? {
      ad_id: key, headline: a.headline ?? '', conversations: 0, qualified: 0, site_visit: 0, won: 0, won_value: 0, qualified_rate: 0,
    }
    row.conversations++
    if (!row.headline && a.headline) row.headline = a.headline
    rows.set(key, row)
  }

  for (const e of events) {
    if (e.undone_at) continue
    const a = latest.get(e.conversation_id)
    if (!a) continue
    const row = rows.get(a.ad_id ?? 'unknown')!
    row[e.stage]++
    if (e.stage === 'won') row.won_value += Number(e.value) || 0
  }

  for (const row of rows.values()) {
    row.qualified_rate = row.conversations ? row.qualified / row.conversations : 0
  }
  return [...rows.values()].sort((x, y) => y.conversations - x.conversations)
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function adReportToCsv(rows: AdReportRow[]): string {
  const header = 'Ad ID,Headline,Conversations,Qualified,Site visit,Won,Won value (QAR),Qualified rate\n'
  const body = rows
    .map((r) =>
      [r.ad_id, r.headline, r.conversations, r.qualified, r.site_visit, r.won, r.won_value.toFixed(2), `${(r.qualified_rate * 100).toFixed(1)}%`]
        .map(csvCell)
        .join(','),
    )
    .map((line) => `${line}\n`)
    .join('')
  return header + body
}
