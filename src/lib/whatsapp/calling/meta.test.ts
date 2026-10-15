import { afterEach, describe, expect, it, vi } from 'vitest';
import { callingRequest, callAction, getCallPermissions } from './meta';
import { canPerformCallAction } from './types';

const config = { phone_number_id: '123', access_token: 'private-token' };
afterEach(() => vi.unstubAllGlobals());
describe('calling transport', () => {
  it('sends voice SDP with server-side bearer auth and no cached response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ calls: [{ id: 'wacid.1' }] }));
    vi.stubGlobal('fetch', fetch);
    await callAction(config, {
      action: 'connect',
      to: '97455555555',
      session: { sdp_type: 'offer', sdp: 'voice-sdp' },
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/123/calls');
    expect(url).not.toContain(config.access_token);
    expect(init.headers.Authorization).toBe('Bearer private-token');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body)).toMatchObject({
      messaging_product: 'whatsapp',
      action: 'connect',
      session: { sdp_type: 'offer' },
    });
  });
  it('queries permission for the specific recipient', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ permission: { status: 'permanent' } })
      );
    vi.stubGlobal('fetch', fetch);
    await getCallPermissions(config, '97455555555');
    expect(fetch.mock.calls[0][0]).toContain(
      '/call_permissions?user_wa_id=97455555555'
    );
    expect(fetch.mock.calls[0][1].method).toBe('GET');
  });
  it('surfaces an actionable Meta error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              message: 'Invalid parameter',
              error_data: { details: 'Calling is not enabled' },
            },
          },
          { status: 400 }
        )
      )
    );
    await expect(callingRequest(config, 'settings')).rejects.toMatchObject({
      message: 'Calling is not enabled',
      status: 502,
    });
  });
  it('fails closed when permission exists but a call limit applies', () => {
    expect(
      canPerformCallAction(
        {
          permission: { status: 'permanent' },
          actions: [{ action_name: 'start_call', can_perform_action: false }],
        },
        'start_call'
      )
    ).toBe(false);
    expect(canPerformCallAction({}, 'start_call')).toBe(false);
    expect(
      canPerformCallAction(
        { actions: [{ action_name: 'start_call', can_perform_action: true }] },
        'start_call'
      )
    ).toBe(true);
  });
});
