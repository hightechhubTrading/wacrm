import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), cookie: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.user }));
vi.mock('./server', () => ({ createClient: mocks.cookie }));
import { createRequestClient } from './request';
beforeEach(() => vi.clearAllMocks());
it('preserves existing cookie auth without a bearer header', async () => {
  await createRequestClient(new Request('https://app.test'));
  expect(mocks.cookie).toHaveBeenCalledOnce();
  expect(mocks.user).not.toHaveBeenCalled();
});
it('uses a public-key RLS user client without persistent server sessions', async () => {
  await createRequestClient(
    new Request('https://app.test', {
      headers: { authorization: 'Bearer user.jwt.signature' },
    })
  );
  expect(mocks.cookie).not.toHaveBeenCalled();
  expect(mocks.user).toHaveBeenCalledWith(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    expect.objectContaining({
      global: { headers: { Authorization: 'Bearer user.jwt.signature' } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  );
});
it('does not fall back to cookies for malformed credentials', async () => {
  await expect(
    createRequestClient(
      new Request('https://app.test', {
        headers: { authorization: 'Basic invalid' },
      })
    )
  ).rejects.toThrow();
  expect(mocks.cookie).not.toHaveBeenCalled();
});
it('the real SDK validates the bearer against Auth instead of trusting decoded claims', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>(
    '@supabase/supabase-js'
  );
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.fixture.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-fixture-key');
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer user.jwt.signature'
    );
    return Response.json({
      id: 'verified-user',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01',
    });
  });
  vi.stubGlobal('fetch', transport);
  try {
    mocks.user.mockImplementationOnce(actual.createClient);
    const db = await createRequestClient(
      new Request('https://app.test', {
        headers: { authorization: 'Bearer user.jwt.signature' },
      })
    );
    const result = await db.auth.getUser();
    expect(result.error).toBeNull();
    expect(result.data.user?.id).toBe('verified-user');
    expect(transport).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
