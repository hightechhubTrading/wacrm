/** Parse only the coordinate URL emitted by our inbound WhatsApp mapper.
 * The customer's optional label stays display text, never a navigation target. */
export function sharedLocation(
  text: string | null | undefined
): { url: string; label: string | null } | null {
  const lines = (text ?? '').split('\n').map((line) => line.trim());
  for (const line of lines) {
    try {
      const url = new URL(line);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'www.google.com' ||
        url.pathname !== '/maps'
      )
        continue;
      const coordinates = url.searchParams.get('q')?.split(',');
      if (
        !coordinates ||
        coordinates.length !== 2 ||
        coordinates.some((v) => !v.trim())
      )
        continue;
      const [latitude, longitude] = coordinates.map(Number);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      )
        continue;
      return {
        url: url.href,
        label:
          lines.filter((value) => value && value !== line).join(' — ') || null,
      };
    } catch {
      /* Place labels are not URLs. */
    }
  }
  return null;
}
