export function quietNow(
  quiet: {
    quiet_start: number | null;
    quiet_end: number | null;
    timezone: string;
  } | null,
  now = new Date()
) {
  if (
    !quiet ||
    quiet.quiet_start === null ||
    quiet.quiet_end === null ||
    quiet.quiet_start === quiet.quiet_end
  )
    return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: quiet.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const minute =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value);
  return quiet.quiet_start < quiet.quiet_end
    ? minute >= quiet.quiet_start && minute < quiet.quiet_end
    : minute >= quiet.quiet_start || minute < quiet.quiet_end;
}
export function targetHref(notice: {
  conversation_id?: string;
  target_kind?: string;
  target_id?: string;
  type: string;
}) {
  if (notice.target_kind === 'quotation' && notice.target_id)
    return `/quotations/${encodeURIComponent(notice.target_id)}`;
  if (notice.target_kind === 'appointment') return '/calendar';
  if (notice.conversation_id)
    return `/inbox?c=${encodeURIComponent(notice.conversation_id)}`;
  if (notice.type === 'ai_key_invalid') return '/agents?tab=setup';
  return null;
}
