import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  effects: [] as (() => () => void)[],
  client: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => () => void) => {
    harness.effects.push(fn);
  },
  useRef: (initial: unknown) =>
    harness.refs[harness.refCursor++] ??
    (harness.refs[harness.refCursor - 1] = { current: initial }),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [
      harness.states[index],
      (next: unknown) => {
        harness.states[index] =
          typeof next === 'function' ? next(harness.states[index]) : next;
      },
    ];
  },
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account' }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: harness.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: harness.toast } }));
import { CustomFieldGroupFields } from './custom-field-group-fields';

let rows: Record<string, unknown[]>;
let failures: Set<string>;
let calls: string[];
const props = {
  scope: 'contact' as const,
  recordId: 'customer',
  editable: true,
};
function render(scope: 'contact' | 'deal' = 'contact') {
  harness.cursor = 0;
  harness.refCursor = 0;
  return renderToStaticMarkup(CustomFieldGroupFields({ ...props, scope }));
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let cleanup: (() => void) | undefined;
async function mount(scope: 'contact' | 'deal' = 'contact') {
  render(scope);
  cleanup = harness.effects[0]();
  await flush();
  return render(scope);
}
beforeEach(() => {
  vi.useFakeTimers();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  failures = new Set();
  calls = [];
  rows = {
    custom_field_groups: [],
    custom_fields: [
      {
        id: 'notes',
        field_name: 'Additional Notes from Conversation',
        group_id: null,
        position: 0,
        field_type: 'textarea',
      },
    ],
    contact_custom_values: [
      { custom_field_id: 'notes', value: 'مهتم بنوافذ UPVC' },
    ],
    deal_custom_values: [],
  };
  harness.client.mockReturnValue({
    from: (table: string) => {
      calls.push(table);
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        order: () => query,
        in: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        then: (resolve: (result: unknown) => void) =>
          resolve({
            data: rows[table]?.filter((row) =>
              filters.every(
                ([key, value]) =>
                  !(key in (row as object)) ||
                  (row as Record<string, unknown>)[key] === value
              )
            ),
            error: failures.has(table) ? { message: 'denied' } : null,
          }),
      };
      return query;
    },
  });
  vi.stubGlobal('window', {
    setInterval,
    clearInterval,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', { visibilityState: 'visible' });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows the existing saved standalone notes when there are no contact groups', async () => {
  const html = await mount();
  expect(html).toContain('Additional Notes from Conversation');
  expect(html).toContain('مهتم بنوافذ UPVC');
  expect(html).toContain('id="custom-field-notes"');
});
it('keeps deal fields and hidden groups out of customer details', async () => {
  rows.custom_fields.push({
    id: 'visit',
    group_id: 'deal-group',
    field_name: 'Visit Time',
    position: 1,
  });
  const html = await mount();
  expect(html).not.toContain('Visit Time');
  expect(calls).not.toContain('deal_custom_values');
});
it('does not expose standalone customer fields in deal forms', async () => {
  const html = await mount('deal');
  expect(html).not.toContain('Additional Notes from Conversation');
  expect(calls).not.toContain('contact_custom_values');
});
it('refreshes values written by background collection', async () => {
  await mount();
  rows.contact_custom_values = [
    { custom_field_id: 'notes', value: 'Updated saved detail' },
  ];
  await vi.advanceTimersByTimeAsync(15000);
  expect(render()).toContain('Updated saved detail');
});
it('shows a load failure rather than treating unreadable values as empty', async () => {
  failures.add('contact_custom_values');
  expect(await mount()).toContain('loadFailed');
  expect(render()).toContain('role="alert"');
});
it('discards a pending fetch when the customer panel unmounts', async () => {
  render();
  cleanup = harness.effects[0]();
  cleanup();
  cleanup = undefined;
  await flush();
  expect(harness.states[3]).toBe(false);
});
