import { describe, expect, it } from 'vitest';
import type { Deal, Tag } from '@/types';
import {
  DEFAULT_DEAL_FILTERS,
  NO_TAG,
  UNASSIGNED,
  csvCell,
  dealsCsv,
  filterDeals,
  groupDealsByTag,
  isOverdue,
  readDealView,
  totalsByCurrency,
  writeDealView,
} from './deal-views';

const product = { id: 'roller', name: 'Roller shutters', color: '#555' } as Tag;
const other = { id: 'pergola', name: 'برجولات', color: '#555' } as Tag;
function makeDeal(id: string, overrides: Partial<Deal> = {}): Deal {
  return {
    id,
    user_id: 'owner',
    pipeline_id: 'sales',
    stage_id: 'new',
    contact_id: 'customer',
    title: `Deal ${id}`,
    value: 1500,
    currency: 'QAR',
    created_at: '2026-10-01T10:00:00Z',
    contact: {
      id: 'customer',
      name: 'Mariam',
      phone: '+97455555555',
      tags: [product],
    } as Deal['contact'],
    ...overrides,
  };
}
const deals = [
  makeDeal('a', {
    assigned_to: 'sara',
    expected_close_date: '2026-10-16',
    assignee: { full_name: 'Sara' } as Deal['assignee'],
  }),
  makeDeal('b', {
    status: 'won',
    value: 200,
    currency: 'USD',
    expected_close_date: '2026-10-15',
    contact: { name: 'Omar', tags: [product, other] } as Deal['contact'],
  }),
  makeDeal('c', {
    contact: undefined,
    contact_id: null,
    expected_close_date: '2026-10-17',
  }),
  makeDeal('d', {
    status: 'lost',
    expected_close_date: '2026-10-10',
    contact: { tags: [other] } as Deal['contact'],
  }),
  makeDeal('e', { expected_close_date: '2026-10-24' }),
];
const now = new Date(2026, 9, 17, 14);
const match = (filters: Partial<typeof DEFAULT_DEAL_FILTERS>) =>
  filterDeals(deals, { ...DEFAULT_DEAL_FILTERS, ...filters }, now);

describe('pipeline views', () => {
  it('combines tag, owner, status and overdue filters', () => {
    expect(
      match({
        tag: product.id,
        owner: 'sara',
        status: 'open',
        due: 'overdue',
      }).map((deal) => deal.id)
    ).toEqual(['a']);
    expect(match({ tag: other.id, status: 'open' })).toEqual([]);
  });
  it('searches customer names, phones, Arabic tags and notes case-insensitively', () => {
    expect(match({ query: 'mArIaM' }).map((deal) => deal.id)).toEqual([
      'a',
      'e',
    ]);
    expect(match({ query: 'برجولات' }).map((deal) => deal.id)).toEqual([
      'b',
      'd',
    ]);
    expect(match({ query: '55555555' }).length).toBe(2);
    expect(
      filterDeals(
        [makeDeal('note', { notes: 'Need installation' })],
        { ...DEFAULT_DEAL_FILTERS, query: 'installation' },
        now
      )
    ).toHaveLength(1);
  });
  it('handles untagged, unassigned and deleted customers', () => {
    expect(match({ tag: NO_TAG }).map((deal) => deal.id)).toEqual(['c']);
    expect(match({ owner: UNASSIGNED })).toHaveLength(4);
  });
  it('only counts open deals as overdue and compares local calendar dates', () => {
    expect(match({ due: 'overdue' }).map((deal) => deal.id)).toEqual(['a']);
    expect(match({ due: 'today' }).map((deal) => deal.id)).toEqual(['c']);
    expect(match({ due: 'week' }).map((deal) => deal.id)).toEqual(['c', 'e']);
    expect(isOverdue(deals[1], '2026-10-17')).toBe(false);
    expect(
      filterDeals(
        [makeDeal('no-date')],
        { ...DEFAULT_DEAL_FILTERS, due: 'undated' },
        now
      )
    ).toHaveLength(1);
  });
  it('sorts without mutating source data and puts missing close dates last', () => {
    const source = [
      makeDeal('z'),
      makeDeal('soon', { expected_close_date: '2026-10-18' }),
    ];
    expect(
      filterDeals(
        source,
        { ...DEFAULT_DEAL_FILTERS, sort: 'closing' },
        now
      ).map((deal) => deal.id)
    ).toEqual(['soon', 'z']);
    expect(source.map((deal) => deal.id)).toEqual(['z', 'soon']);
  });
  it('groups by existing tags without inflating source totals', () => {
    const groups = groupDealsByTag(deals);
    expect(groups.find((group) => group.id === product.id)?.deals).toHaveLength(
      3
    );
    expect(groups.find((group) => group.id === other.id)?.deals).toHaveLength(
      2
    );
    expect(groups.find((group) => group.id === NO_TAG)?.deals[0].id).toBe('c');
    expect(deals).toHaveLength(5);
    expect(totalsByCurrency(deals, 'QAR')).toEqual([
      { currency: 'QAR', value: 6000 },
      { currency: 'USD', value: 200 },
    ]);
  });
  it('uses account currency for legacy deals and filters currencies correctly', () => {
    expect(
      totalsByCurrency([makeDeal('legacy', { currency: undefined })], 'EUR')
    ).toEqual([{ currency: 'EUR', value: 1500 }]);
    expect(match({ currency: 'USD' }).map((deal) => deal.id)).toEqual(['b']);
  });
  it('round-trips shareable views and rejects invalid enum values', () => {
    const filters = {
      ...DEFAULT_DEAL_FILTERS,
      query: 'برجولات & shutters',
      tag: product.id,
      due: 'overdue' as const,
      sort: 'closing' as const,
    };
    const params = writeDealView(
      new URLSearchParams('pipeline=sales'),
      'tags',
      filters
    );
    expect(params.get('pipeline')).toBe('sales');
    expect(readDealView(params)).toEqual({ view: 'tags', filters });
    expect(
      readDealView(
        new URLSearchParams('view=invalid&status=deleted&due=never&sort=oops')
      )
    ).toEqual({ view: 'board', filters: DEFAULT_DEAL_FILTERS });
  });
  it('escapes CSV content and prevents spreadsheet formulas', () => {
    expect(csvCell(' =HYPERLINK("bad")')).toBe('"\' =HYPERLINK(""bad"")"');
    expect(csvCell('+97455555555')).toBe('"\'+97455555555"');
    expect(csvCell('A, "B"\nC')).toBe('"A, ""B""\nC"');
    const csv = dealsCsv(
      [
        makeDeal('csv', {
          title: '=1+1',
          aiSummary: {
            text: '=untrusted recap',
            at: null,
            conversationId: 'chat',
          },
        }),
      ],
      new Map([['new', 'New enquiry']]),
      ['Deal']
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"New enquiry"');
    expect(csv).toContain('"\'=untrusted recap"');
  });
});
