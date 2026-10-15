/** Semantic meaning is stable across accent themes and light/dark modes. */
export type UiTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'optional';

export const STATUS_TONES: Readonly<Record<string, UiTone>> = {
  draft: 'neutral',
  inactive: 'neutral',
  archived: 'neutral',
  cancelled: 'neutral',
  open: 'info',
  sent: 'info',
  sending: 'info',
  running: 'info',
  processing: 'info',
  waiting: 'warning',
  blocked: 'warning',
  in_progress: 'info',
  report_received: 'success',
  ready: 'success',
  installed: 'success',
  pending: 'warning',
  scheduled: 'warning',
  expired: 'warning',
  away: 'warning',
  won: 'success',
  closed: 'success',
  completed: 'success',
  active: 'success',
  connected: 'success',
  online: 'success',
  delivered: 'success',
  read: 'success',
  replied: 'success',
  failed: 'danger',
  error: 'danger',
  lost: 'danger',
  disconnected: 'danger',
};
export function statusTone(status: string): UiTone {
  return Object.hasOwn(STATUS_TONES, status) ? STATUS_TONES[status] : 'neutral';
}
export function toneClasses(tone: UiTone): string {
  return `ui-tone ui-tone-${tone}`;
}
export function statusClasses(status: string): string {
  return toneClasses(statusTone(status));
}
export function pricingTone(kind?: string | null): UiTone {
  return kind === 'Included'
    ? 'success'
    : kind === 'Optional'
      ? 'optional'
      : 'info';
}

/** Area colors identify navigation/groups; they never override state colors. */
export type UiArea =
  'people' | 'sales' | 'documents' | 'operations' | 'settings';
export function areaForPath(path: string): UiArea {
  const first = path.split('/')[1];
  if (['inbox', 'contacts', 'broadcasts'].includes(first)) return 'people';
  if (['pipelines', 'ad-conversions', 'inventory', 'catalog'].includes(first))
    return 'sales';
  if (first === 'quotations') return 'documents';
  if (
    ['automations', 'flows', 'agents', 'jobs', 'notifications'].includes(first)
  )
    return 'operations';
  return 'settings';
}
