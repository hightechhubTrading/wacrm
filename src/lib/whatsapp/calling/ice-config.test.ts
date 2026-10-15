import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { callingIceServers } from './ice-config';

describe('calling relay credentials', () => {
  it('issues expiring, user-specific coturn credentials without exposing the shared secret', () => {
    const secret = 'test-server-only-secret';
    const servers = callingIceServers(
      'agent-id',
      {
        WHATSAPP_CALLING_ICE_SERVERS_JSON: '[]',
        WHATSAPP_CALLING_TURN_URLS_JSON:
          '["turn:relay.example:3478?transport=tcp"]',
        WHATSAPP_CALLING_TURN_SECRET: secret,
      },
      1_700_000_000_000
    );
    expect(servers).toEqual([
      {
        urls: ['turn:relay.example:3478?transport=tcp'],
        username: '1700003600:agent-id',
        credential: createHmac('sha1', secret)
          .update('1700003600:agent-id')
          .digest('base64'),
      },
    ]);
    expect(JSON.stringify(servers)).not.toContain(secret);
  });
  it.each([
    { WHATSAPP_CALLING_ICE_SERVERS_JSON: '{}' },
    { WHATSAPP_CALLING_ICE_SERVERS_JSON: '[null]' },
    { WHATSAPP_CALLING_ICE_SERVERS_JSON: '[{"urls":"https://bad.example"}]' },
    { WHATSAPP_CALLING_TURN_SECRET: 'secret' },
    { WHATSAPP_CALLING_TURN_URLS_JSON: '["turn:relay.example"]' },
    {
      WHATSAPP_CALLING_TURN_SECRET: 'secret',
      WHATSAPP_CALLING_TURN_URLS_JSON: '["stun:relay.example"]',
    },
  ])('rejects invalid or partial relay configuration', (env) => {
    expect(() => callingIceServers('agent', env)).toThrow(
      'Invalid calling ICE configuration'
    );
  });
});
