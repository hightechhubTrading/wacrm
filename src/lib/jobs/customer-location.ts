import { sharedLocation } from '@/lib/inbox/shared-location';

/** Only a customer-authored pin or recognized map link is a location source. */
export function customerLocation(message: {
  sender_type: string;
  content_type: string;
  content_text: string | null;
}): string | null {
  if (message.sender_type !== 'customer') return null;
  const text = message.content_text ?? '';
  if (message.content_type === 'location') {
    const pin = sharedLocation(text);
    return pin
      ? [pin.label?.slice(0, 800), pin.url]
          .filter(Boolean)
          .join(' — ')
          .slice(0, 1000)
      : null;
  }
  if (message.content_type !== 'text') return null;
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+/g)) {
    try {
      const url = new URL(match[0].replace(/[),.،؛]+$/, ''));
      if (url.username || url.password) continue;
      if (
        (['www.google.com', 'maps.google.com'].includes(url.hostname) &&
          url.pathname.startsWith('/maps')) ||
        url.hostname === 'maps.app.goo.gl' ||
        (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')) ||
        url.hostname === 'maps.apple.com'
      )
        return url.href.slice(0, 1000);
    } catch {
      /* Ignore malformed links; never guess an address. */
    }
  }
  return null;
}
