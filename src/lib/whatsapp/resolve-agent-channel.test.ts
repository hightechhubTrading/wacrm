import { describe, it, expect, vi } from 'vitest';
import { resolveAgentWahaChannel } from './resolve-agent-channel';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace('enc:', ''),
}));

function makeDb(rows: { profile?: unknown; wahaConfig?: unknown }) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'profiles'
              ? { data: rows.profile ?? null, error: null }
              : { data: rows.wahaConfig ?? null, error: null },
          ),
      };
      return builder;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('resolveAgentWahaChannel', () => {
  // Note: A Supabase query error is treated the same as "not found" (returns null).
  // The resolver intentionally falls back to Meta's shared number on any resolution gap,
  // treating missing data, null fields, and query errors identically for robustness.

  it('returns null when no agent is assigned', async () => {
    const db = makeDb({});
    expect(await resolveAgentWahaChannel(db, 'acct-1', null)).toBeNull();
  });

  it('returns null when profile query returns no row', async () => {
    const db = makeDb({ profile: null });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when the assigned agent has no session or phone', async () => {
    const db = makeDb({ profile: { waha_session_name: null, phone: null } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when the agent has a session but no phone', async () => {
    const db = makeDb({ profile: { waha_session_name: 'sarah-agent', phone: null } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when the agent has a phone but no session', async () => {
    const db = makeDb({ profile: { waha_session_name: null, phone: '+15551234567' } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when waha_config is missing', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: null,
    });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when waha_config is inactive', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: 'https://waha.example.com', api_key: 'enc:key', is_active: false },
    });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when waha_config is missing api_key', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: 'https://waha.example.com', api_key: null, is_active: true },
    });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when waha_config is missing base_url', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: null, api_key: 'enc:key', is_active: true },
    });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns the resolved channel when everything is configured', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: 'https://waha.example.com', api_key: 'enc:key', is_active: true },
    });
    const result = await resolveAgentWahaChannel(db, 'acct-1', 'user-1');
    expect(result).toEqual({
      baseUrl: 'https://waha.example.com',
      apiKey: 'key',
      session: 'sarah-agent',
      agentPhone: '+15551234567',
    });
  });
});
