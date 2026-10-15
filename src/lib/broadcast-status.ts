import { statusClasses } from './ui-colors';
/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Colors come from the shared semantic palette, independent of accent theme.
 */

import type { BroadcastStatus, RecipientStatus } from '@/types';

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: 'draft',
    classes: statusClasses('draft'),
  },
  scheduled: {
    label: 'scheduled',
    classes: statusClasses('scheduled'),
  },
  sending: {
    label: 'sending',
    classes: statusClasses('sending'),
    pulse: true,
  },
  sent: {
    label: 'sent',
    classes: statusClasses('sent'),
  },
  failed: {
    label: 'failed',
    classes: statusClasses('failed'),
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: 'pending',
    classes: statusClasses('pending'),
  },
  sent: {
    label: 'sent',
    classes: statusClasses('sent'),
  },
  delivered: {
    label: 'delivered',
    classes: statusClasses('delivered'),
  },
  read: {
    label: 'read',
    classes: statusClasses('read'),
  },
  replied: {
    label: 'replied',
    classes: statusClasses('replied'),
  },
  failed: {
    label: 'failed',
    classes: statusClasses('failed'),
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
