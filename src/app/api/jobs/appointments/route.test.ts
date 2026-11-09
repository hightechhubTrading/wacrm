import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  from: vi.fn(),
  adminFrom: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.role,
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ from: mocks.adminFrom, rpc: mocks.rpc }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { send: {} },
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
import { GET, POST } from './route';
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const name of [
    'select',
    'eq',
    'neq',
    'in',
    'not',
    'is',
    'lt',
    'gt',
    'order',
    'limit',
  ])
    q[name] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}
let data: Record<string, { data: unknown; error: unknown }>;
let busy: { data: unknown; error: unknown };
beforeEach(() => {
  vi.resetAllMocks();
  data = {
    profiles: {
      data: [{ id: id(2), user_id: id(3), full_name: 'Requester' }],
      error: null,
    },
    job_appointments: {
      data: [
        {
          id: id(4),
          starts_at: '2035-01-01T08:00:00Z',
          ends_at: '2035-01-01T09:00:00Z',
          status: 'reserved',
          work: { reference: 42 },
        },
      ],
      error: null,
    },
    group_handoffs: { data: [], error: null },
  };
  busy = {
    data: [
      {
        id: id(5),
        starts_at: '2035-01-01T10:00:00Z',
        ends_at: '2035-01-01T11:00:00Z',
        status: 'reserved',
        work: { private: 'Hidden customer' },
      },
    ],
    error: null,
  };
  mocks.from.mockImplementation((name) => chain(data[name]));
  mocks.adminFrom.mockImplementation(() => chain(busy));
  mocks.role.mockResolvedValue({
    accountId: id(1),
    userId: id(3),
    role: 'agent',
    supabase: { from: mocks.from },
  });
  mocks.rpc.mockResolvedValue({ data: id(4), error: null });
});
const get = () =>
  GET(
    new Request(
      'http://local/api/jobs/appointments?from=2035-01-01T00:00:00Z&to=2035-01-08T00:00:00Z'
    )
  );
const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request('http://local/api/jobs/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dealId: id(6),
        handoffId: id(7),
        starts_at: '2035-01-01T08:00:00Z',
        ends_at: '2035-01-01T09:00:00Z',
        ...extra,
      }),
    })
  );
describe('company appointment API', () => {
  it('requires an operational session', async () => {
    mocks.role.mockRejectedValue(new Error('unauthorized'));
    expect((await get()).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
  it('bounds reads and rejects timezone-free dates', async () => {
    expect(
      (await GET(new Request('http://local?from=2035-01-01&to=2036-01-01')))
        .status
    ).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('includes anonymous busy times for hidden jobs without exposing their details', async () => {
    const res = await get(),
      body = await res.json();
    expect(res.status).toBe(200);
    expect(
      body.appointments.find((a: { id: string }) => a.id === id(5))
    ).toEqual({
      id: id(5),
      starts_at: '2035-01-01T10:00:00Z',
      ends_at: '2035-01-01T11:00:00Z',
      status: 'reserved',
    });
    expect(JSON.stringify(body)).not.toContain('Hidden customer');
    expect(body.defaultResponsibleId).toBe(id(2));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.adminFrom.mock.results[0].value.eq).toHaveBeenCalledWith(
      'account_id',
      id(1)
    );
    expect(mocks.adminFrom.mock.results[0].value.select).toHaveBeenCalledWith(
      'id,starts_at,ends_at,status'
    );
  });
  it('fails closed when company-wide availability cannot be read', async () => {
    busy = { data: null, error: { message: 'unavailable' } };
    expect((await get()).status).toBe(503);
  });
  it('does not schedule a job hidden by assignment RLS', async () => {
    data.group_handoffs = { data: null, error: null };
    expect((await post()).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('defaults to the caller profile, derives tenant/actor and passes stale-edit revision', async () => {
    data.group_handoffs = { data: { id: id(7) }, error: null };
    expect(
      (await post({ accountId: 'foreign', actor: 'attacker', revision: 3 }))
        .status
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_job_appointment',
      expect.objectContaining({
        p_account: id(1),
        p_actor: id(3),
        p_responsible: id(2),
        p_revision: 3,
        p_deal: id(6),
        p_handoff: id(7),
      })
    );
  });
  it('rejects free-text owners and past or reversed time intervals', async () => {
    expect((await post({ responsible_profile_id: 'John' })).status).toBe(400);
    expect((await post({ ends_at: '2034-01-01T00:00:00Z' })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns safe conflict and stale-revision responses', async () => {
    data.group_handoffs = { data: { id: id(7) }, error: null };
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23P01', message: 'Private job name' },
    });
    const conflict = await post();
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('slot_unavailable');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const stale = await post({ revision: 0 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('stale_booking');
  });
});
