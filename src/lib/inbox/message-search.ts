import { businessDateTimeToIso } from '@/lib/business-time';
export interface MessageSearchItem {
  id: string;
  conversation_id: string;
  created_at: string | null;
  sender_type: 'customer' | 'agent' | 'bot';
  content_type: string;
  contact_name: string | null;
  contact_phone: string | null;
  excerpt: string;
  source: 'message' | 'transcript' | 'mixed';
}
export type SearchCursor = { created_at: string; id: string };
export interface MessageSearchQuery {
  query: string;
  conversationId: string | null;
  sender: string | null;
  from: string | null;
  to: string | null;
}
/** Search dates use the shared Qatar calendar, regardless of the device timezone. */
export function searchDayBoundary(
  value: string,
  nextDay = false
): string | null {
  if (!value) return null;
  const base = businessDateTimeToIso(`${value}T00:00`);
  if (!base) return null;
  if (!nextDay) return base;
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
  return businessDateTimeToIso(`${next}T00:00`);
}
