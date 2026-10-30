import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Deal } from '@/types';
import { DEFAULT_DEAL_FILTERS } from './deal-views';
import {
  readPipelineExport,
  readPipelinePage,
  type PipelineQuery,
} from './page';
const query: PipelineQuery = {
  pipelineId: 'pipeline',
  filters: { ...DEFAULT_DEAL_FILTERS, query: 'remote customer' },
  view: 'list',
  page: 0,
  stagePages: {},
  fallbackCurrency: 'QAR',
};
afterEach(() => vi.useRealTimers());
describe('pipeline page transport', () => {
  it('passes local calendar boundaries, global filters and cancellation to the RPC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 12));
    const abortSignal = vi.fn();
    const result = { data: { items: [], total: 0 }, error: null };
    const builder = {
      abortSignal,
      then: (yes: (r: unknown) => unknown) => Promise.resolve(result).then(yes),
    };
    abortSignal.mockReturnValue(builder);
    const rpc = vi.fn(() => builder),
      signal = new AbortController().signal;
    await readPipelinePage({ rpc } as unknown as SupabaseClient, query, signal);
    expect(rpc).toHaveBeenCalledWith(
      'pipeline_list',
      expect.objectContaining({
        p_pipeline: 'pipeline',
        p_filters: query.filters,
        p_today: '2026-10-30',
        p_week_end: '2026-11-06',
        p_fallback_currency: 'QAR',
        p_view: 'list',
        p_page: 0,
      })
    );
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });
  it('exports every matching record beyond the loaded page', async () => {
    const rpc = vi.fn((_name, args) =>
      Promise.resolve({
        data: {
          page: args.p_page,
          total: 251,
          items: Array.from(
            { length: Math.min(100, 251 - args.p_page * 100) },
            (_, i) => ({ id: String(args.p_page * 100 + i) }) as Deal
          ),
        },
        error: null,
      })
    );
    const rows = await readPipelineExport(
      { rpc } as unknown as SupabaseClient,
      query
    );
    expect(rows).toHaveLength(251);
    expect(rows.at(-1)?.id).toBe('250');
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(
      rpc.mock.calls.every(
        ([, args]) =>
          args.p_view === 'export' && args.p_filters === query.filters
      )
    ).toBe(true);
  });
  it('fails instead of silently exporting a changing or incomplete result set', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          page: 0,
          total: 101,
          items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { page: 1, total: 102, items: [{ id: '100' }] },
        error: null,
      });
    await expect(
      readPipelineExport({ rpc } as unknown as SupabaseClient, query)
    ).rejects.toThrow('changed during export');
    const duplicate = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          page: 0,
          total: 101,
          items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { page: 1, total: 101, items: [{ id: '1' }] },
        error: null,
      });
    await expect(
      readPipelineExport({ rpc: duplicate } as unknown as SupabaseClient, query)
    ).rejects.toThrow('changed during export');
  });
  it('propagates missing RPC errors without an unbounded fallback', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('missing migration') });
    await expect(
      readPipelinePage({ rpc } as unknown as SupabaseClient, query)
    ).rejects.toThrow('missing migration');
    expect(rpc).toHaveBeenCalledOnce();
  });
});
