import { afterEach, describe, expect, it, vi } from 'vitest';

// Account context uses fresh getUser plus an invoker-RLS SQL snapshot. It must
// not depend on a PostgREST embedded FK relationship (regression #294).
function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const rpc = vi.fn(async () => {
    const profile = opts.byTable.profiles,
      account = opts.byTable.accounts;
    return {
      data: profile?.data
        ? {
            profile: { user_id: opts.user?.id, ...(profile.data as object) },
            account: account?.data ?? null,
          }
        : null,
      error: profile?.error || account?.error || null,
    };
  });
  const getUser = vi.fn(async () => ({
    data: { user: opts.user },
    error: opts.userErr ?? null,
  }));
  return { rpc, getUser, client: { auth: { getUser }, rpc } };
}

const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));

const {
  getCurrentAccount,
  UnauthorizedError,
  ForbiddenError,
  toErrorResponse,
} = await import('./account');

afterEach(() => {
  vi.clearAllMocks();
});

describe('getCurrentAccount', () => {
  it('resolves context with fresh user validation and one RLS snapshot', async () => {
    const { client, rpc, getUser } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'owner' },
          error: null,
        },
        accounts: { data: { id: 'acct-1', name: 'Acme' }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'owner',
      account: { id: 'acct-1', name: 'Acme' },
    });

    expect(getUser).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('account_profile');
    expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]
    );
  });

  it('rejects a snapshot for a different user or a mismatched account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            user_id: 'other',
            account_id: 'acct-1',
            account_role: 'owner',
          },
          error: null,
        },
        accounts: { data: { id: 'acct-1', name: 'Acme' }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(ForbiddenError);
    const mismatch = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'owner' },
          error: null,
        },
        accounts: { data: { id: 'different', name: 'Acme' }, error: null },
      },
    });
    createClient.mockReturnValue(mismatch.client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws UnauthorizedError when there is no session', async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: { data: null, error: { code: 'PGRST200' } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Could not load account context'
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'admin' },
          error: null,
        },
        accounts: { data: null, error: { code: 'PGRST200' } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('Could not load account context');
  });

  it('rejects a profile not linked to an account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: null, account_role: null },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Profile is not linked to an account'
    );
  });

  it('rejects an account_id that resolves to no readable account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'viewer' },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Profile is not linked to an account'
    );
  });
});

describe('fresh session validation', () => {
  it('rejects a revoked user before reading any account snapshot', async () => {
    const { client, rpc } = makeClient({
      user: { id: 'user-1' },
      userErr: new Error('revoked'),
      byTable: {},
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('toErrorResponse', () => {
  it('maps UnauthorizedError to its own status (401)', async () => {
    const res = toErrorResponse(new UnauthorizedError('nope'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nope' });
  });

  it('maps ForbiddenError to its own status (403)', async () => {
    const res = toErrorResponse(new ForbiddenError('no way'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'no way' });
  });

  // Fix 6: any other error that carries its own valid HTTP status
  // (e.g. SendMessageError from src/lib/whatsapp/send-message.ts) is
  // honored, instead of every non-Unauthorized/Forbidden error
  // collapsing to a generic 500 and discarding a genuinely useful
  // validation message.
  it("honors a plain Error's own .status instead of collapsing to 500", async () => {
    class FakeStatusError extends Error {
      status = 400;
    }
    const res = toErrorResponse(new FakeStatusError('bad phone number'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad phone number' });
  });

  it('ignores a non-HTTP-range .status and falls back to 500', async () => {
    class WeirdError extends Error {
      status = 12345;
    }
    const res = toErrorResponse(new WeirdError('boom'));
    expect(res.status).toBe(500);
  });

  it('collapses an uncategorized plain Error (no .status) to a generic 500', async () => {
    const res = toErrorResponse(new Error('some internal detail'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });

  it('collapses a non-Error thrown value to a generic 500', async () => {
    const res = toErrorResponse('just a string');
    expect(res.status).toBe(500);
  });
});
