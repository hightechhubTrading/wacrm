import { describe, expect, it } from 'vitest'
import { adReportToCsv, buildAdReport } from './report'

const attrs = [
  { conversation_id: 'c1', ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-01T10:00:00+00:00' },
  { conversation_id: 'c2', ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-02T10:00:00+00:00' },
  { conversation_id: 'c3', ad_id: 'B', headline: 'Shutters', clicked_at: '2026-09-03T10:00:00+00:00' },
  // c3 clicked A earlier -- latest click (B) wins.
  { conversation_id: 'c3', ad_id: 'A', headline: 'Garage', clicked_at: '2026-08-30T10:00:00+00:00' },
]

const events = [
  { conversation_id: 'c1', stage: 'qualified' as const, value: null, undone_at: null },
  { conversation_id: 'c1', stage: 'won' as const, value: '45000.00', undone_at: null },
  { conversation_id: 'c2', stage: 'qualified' as const, value: null, undone_at: '2026-09-05T00:00:00Z' },
  { conversation_id: 'c3', stage: 'site_visit' as const, value: null, undone_at: null },
  { conversation_id: 'zz', stage: 'qualified' as const, value: null, undone_at: null },
]

describe('buildAdReport', () => {
  it('groups by each conversation\'s latest ad and skips undone tags', () => {
    expect(buildAdReport(attrs, events)).toEqual([
      { ad_id: 'A', headline: 'Garage', conversations: 2, qualified: 1, site_visit: 0, won: 1, won_value: 45000, qualified_rate: 0.5 },
      { ad_id: 'B', headline: 'Shutters', conversations: 1, qualified: 0, site_visit: 1, won: 0, won_value: 0, qualified_rate: 0 },
    ])
  })

  it('returns an empty report for no attributions', () => {
    expect(buildAdReport([], events)).toEqual([])
  })
})

describe('adReportToCsv', () => {
  it('writes a header and escapes commas and quotes', () => {
    const csv = adReportToCsv([
      { ad_id: 'A', headline: 'Doors, "fast"', conversations: 4, qualified: 1, site_visit: 0, won: 1, won_value: 1200.5, qualified_rate: 0.25 },
    ])
    expect(csv).toBe(
      'Ad ID,Headline,Conversations,Qualified,Site visit,Won,Won value (QAR),Qualified rate\n' +
        'A,"Doors, ""fast""",4,1,0,1,1200.50,25.0%\n',
    )
  })
})
