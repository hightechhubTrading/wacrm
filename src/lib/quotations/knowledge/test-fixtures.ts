import type { KnowledgeRecord } from './types';
import type { QuotationItemToSave } from '../crud';
export const id = '11111111-1111-4111-8111-111111111111';
export const record: KnowledgeRecord = {
  id,
  batch_id: '22222222-2222-4222-8222-222222222222',
  record_key: 'price:2',
  kind: 'price',
  source: 'price_list_clean_2026-04-29.csv',
  source_row: 2,
  data: { item_en: '55 mm shutter', col_O: '390' },
  review_status: 'approved',
  review_version: 1,
  reviewed_at: '2026-11-02T00:00:00Z',
  review_notes: 'Confirmed by fixture',
  configuration: {
    family: 'WS',
    pricing: { basis: 'area', rate: 390, currency: 'QAR', column: 'O' },
  },
};
export const item: QuotationItemToSave = {
  id: '33333333-3333-4333-8333-333333333333',
  itemType: 'line',
  description: 'Shutter',
  sizeW: 138,
  sizeH: 165,
  measurementUnit: 'cm',
  qty: 2,
  unit: 'm2',
};
