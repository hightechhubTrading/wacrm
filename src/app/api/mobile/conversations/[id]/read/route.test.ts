import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  client: vi.fn(),
  role: 'agent',
  user: true,
  member: true,
  visible: true,
  updated: true,
  updateError: false,
  readError: false,
  filters: [] as unknown[],
  tables: [] as string[],
  patches: [] as unknown[],
  count: 2,
}));
vi.mock('@/lib/supabase/request', () => ({ createRequestClient: h.client }));
import { POST, OPTIONS } from './route';
import { GET } from '../contact/route';
const id = '12345678-1234-4234-8234-123456789abc';
const stamp = '2026-11-16T12:00:00+00:00';
const context = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(h, {
    role: 'agent',
    user: true,
    member: true,
    visible: true,
    updated: true,
    updateError: false,
    readError: false,
    count: 2,
    filters: [],
    tables: [],
    patches: [],
  });
  h.client.mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: { user: h.user ? { id: 'user-a' } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      h.tables.push(table);
      let patch = false;
      const terminal = async () => {
        if (table === 'profiles')
          return {
            data: h.member
              ? { account_id: 'account-a', account_role: h.role }
              : null,
            error: null,
          };
        if (table === 'conversations')
          return {
            data: patch
              ? h.updated
                ? { id }
                : null
              : h.visible
                ? {
                    id,
                    contact_id: 'contact-a',
                    unread_count: h.count,
                    last_message_at: stamp,
                  }
                : null,
            error: patch && h.updateError ? {} : null,
          };
        if (table === 'contacts')
          return {
            data: {
              id: 'contact-a',
              name: 'Synthetic Person',
              phone: '+0000000',
              email: null,
              company: 'Synthetic Company',
              avatar_url: null,
            },
            error: null,
          };
        return {
          data:
            table === 'contact_tags'
              ? [{ tag: { id: 'tag-a', name: 'Synthetic tag' } }]
              : [
                  {
                    id: 'note-a',
                    note_text: 'ملاحظة تجريبية',
                    created_at: stamp,
                  },
                ],
          error: h.readError ? {} : null,
        };
      };
      const q = {
        select: () => q,
        update: (p: unknown) => {
          patch = true;
          h.patches.push(p);
          return q;
        },
        eq: (key: string, value: unknown) => {
          h.filters.push([table, key, value]);
          return q;
        },
        is: (key: string, value: unknown) => {
          h.filters.push([table, key, value]);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          h.filters.push([table, 'limit', n]);
          return q;
        },
        maybeSingle: terminal,
        then: (resolve: (value: unknown) => unknown) =>
          terminal().then(resolve),
      };
      return q;
    },
  });
});
function req(
  method = 'POST',
  body: unknown = { unread_count: 2, last_message_at: stamp },
  headers: Record<string, string> = {}
) {
  return new Request(
    'https://crm.test/api/mobile/conversations/' + id + '/read',
    {
      method,
      headers: {
        Origin: 'https://localhost',
        Authorization: 'Bearer fixture-token',
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }
  );
}
it('saves only the shared unread count with account and snapshot compare-and-swap filters', async () => {
  const r = await POST(req(), context);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ read: true });
  expect(h.patches).toEqual([{ unread_count: 0 }]);
  expect(h.filters).toContainEqual([
    'conversations',
    'account_id',
    'account-a',
  ]);
  expect(h.filters).toContainEqual(['conversations', 'last_message_at', stamp]);
  expect(h.filters).toContainEqual(['conversations', 'unread_count', 2]);
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe(
    'https://localhost'
  );
});
it('denies missing/invalid bearer, foreign origins, invalid IDs and sessions', async () => {
  for (const [headers, status] of [
    [{ Authorization: '' }, 401],
    [{ Authorization: 'invalid' }, 401],
    [{ Origin: 'https://evil.test' }, 403],
  ] as const)
    expect((await POST(req('POST', undefined, headers), context)).status).toBe(
      status
    );
  expect(h.client).not.toHaveBeenCalled();
  expect(
    (await POST(req(), { params: Promise.resolve({ id: 'invalid' }) })).status
  ).toBe(400);
  h.user = false;
  expect((await POST(req(), context)).status).toBe(401);
  expect(h.patches).toEqual([]);
});
it('denies removed membership, viewers and inaccessible/reassigned conversations', async () => {
  h.member = false;
  expect((await POST(req(), context)).status).toBe(403);
  h.member = true;
  h.role = 'viewer';
  expect((await POST(req(), context)).status).toBe(403);
  h.role = 'agent';
  h.visible = false;
  expect((await POST(req(), context)).status).toBe(404);
  expect(h.patches).toEqual([]);
});
it('does not clear newer messages or report success after a concurrent update/access change', async () => {
  expect(
    (
      await POST(
        req('POST', { unread_count: 1, last_message_at: stamp }),
        context
      )
    ).status
  ).toBe(409);
  expect(
    (
      await POST(
        req('POST', {
          unread_count: 2,
          last_message_at: '2026-11-15T00:00:00Z',
        }),
        context
      )
    ).status
  ).toBe(409);
  expect(h.patches).toEqual([]);
  h.updated = false;
  expect((await POST(req(), context)).status).toBe(409);
});
it('reports database failure without claiming read', async () => {
  h.updateError = true;
  expect((await POST(req(), context)).status).toBe(503);
});
it('is idempotent for an already read matching snapshot', async () => {
  h.count = 0;
  expect(
    (
      await POST(
        req('POST', { unread_count: 0, last_message_at: stamp }),
        context
      )
    ).status
  ).toBe(200);
  expect(h.patches).toEqual([]);
});
it.each([
  null,
  {},
  { unread_count: -1, last_message_at: stamp },
  { unread_count: 1.5, last_message_at: stamp },
  { unread_count: 2, last_message_at: 'bad' },
  { unread_count: 2, last_message_at: stamp, account_id: 'foreign' },
])('rejects malformed read snapshots: %j', async (body) => {
  expect((await POST(req('POST', body), context)).status).toBe(400);
  expect(h.patches).toEqual([]);
});
it('bounds chunked input and restricts preflight', async () => {
  expect((await POST(req('POST', 'x'.repeat(1025)), context)).status).toBe(413);
  expect((await OPTIONS(req('OPTIONS'))).status).toBe(204);
  expect(
    (await OPTIONS(req('OPTIONS', undefined, { Origin: 'https://evil.test' })))
      .status
  ).toBe(403);
});
it('returns scoped, bounded contact information for viewers without mutations', async () => {
  h.role = 'viewer';
  const r = await GET(req('GET'), context);
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.contact.company).toBe('Synthetic Company');
  expect(data.tags).toEqual([{ id: 'tag-a', name: 'Synthetic tag' }]);
  expect(data.notes[0].note_text).toBe('ملاحظة تجريبية');
  expect(h.filters).toContainEqual(['contacts', 'account_id', 'account-a']);
  expect(h.filters).toContainEqual(['contacts', 'id', 'contact-a']);
  expect(h.filters).toContainEqual([
    'contact_notes',
    'account_id',
    'account-a',
  ]);
  expect(h.filters).toContainEqual(['contact_notes', 'limit', 50]);
  expect(h.filters).toContainEqual(['contact_tags', 'limit', 100]);
  expect(h.patches).toEqual([]);
});
it('never returns contact data for hidden conversations or partial query errors', async () => {
  h.visible = false;
  expect((await GET(req('GET'), context)).status).toBe(404);
  expect(h.tables).not.toContain('contacts');
  h.visible = true;
  h.readError = true;
  expect((await GET(req('GET'), context)).status).toBe(503);
});
