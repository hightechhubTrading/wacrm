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
  it('returns null when no agent is assigned', async () => {
    const db = makeDb({});
    expect(await resolveAgentWahaChannel(db, 'acct-1', null)).toBeNull();
  });

  it('returns null when the assigned agent has no session or phone', async () => {
    const db = makeDb({ profile: { waha_session_name: null, phone: null } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when the agent has a session but no phone', async () => {
    const db = makeDb({ profile: { waha_session_name: 'sarah-agent', phone: null } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when waha_config is missing or inactive', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: 'https://waha.example.com', api_key: 'enc:key', is_active: false },
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
