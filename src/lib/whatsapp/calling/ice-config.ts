import { createHmac } from 'node:crypto';
import { CallingError } from './meta';

// Server-only: the shared relay secret never reaches the browser.
export function callingIceServers(
  userId: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now()
): RTCIceServer[] {
  let servers: RTCIceServer[];
  try {
    servers = env.WHATSAPP_CALLING_ICE_SERVERS_JSON
      ? JSON.parse(env.WHATSAPP_CALLING_ICE_SERVERS_JSON)
      : [{ urls: 'stun:stun.l.google.com:19302' }];
    if (
      !Array.isArray(servers) ||
      servers.some((server) => {
        const urls =
          typeof server?.urls === 'string' ? [server.urls] : server?.urls;
        return (
          !Array.isArray(urls) ||
          !urls.length ||
          urls.some(
            (url) =>
              typeof url !== 'string' ||
              !/^(stun|stuns|turn|turns):[^\s]+$/.test(url)
          )
        );
      })
    )
      throw new Error('Invalid servers');
    const relayUrls = env.WHATSAPP_CALLING_TURN_URLS_JSON;
    const secret = env.WHATSAPP_CALLING_TURN_SECRET;
    if (relayUrls || secret) {
      const urls: unknown = JSON.parse(relayUrls || 'null');
      if (
        !secret ||
        !Array.isArray(urls) ||
        !urls.length ||
        urls.some(
          (url) => typeof url !== 'string' || !/^turns?:[^\s]+$/.test(url)
        )
      )
        throw new Error('Invalid relay');
      const username = `${Math.floor(now / 1000) + 3600}:${userId}`;
      servers.push({
        urls,
        username,
        credential: createHmac('sha1', secret)
          .update(username)
          .digest('base64'),
      });
    }
    return servers;
  } catch {
    throw new CallingError('Invalid calling ICE configuration.', 503);
  }
}
