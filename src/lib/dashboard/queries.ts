import type { SupabaseClient } from '@supabase/supabase-js';
import { daysAgoStart, mondayIndex, startOfLocalDay } from './date-utils';
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from './types';

// RPCs aggregate under the caller's table RLS before the API row cap.
// Calendar boundaries and timezone come from the browser, preserving local days.
type DB = SupabaseClient;
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function loadMetrics(db: DB): Promise<MetricsBundle> {
  const { data, error } = await db.rpc('dashboard_metrics', {
    p_today: startOfLocalDay().toISOString(),
    p_yesterday: daysAgoStart(1).toISOString(),
  });
  if (error) throw error;
  return data as MetricsBundle;
}

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number
): Promise<ConversationsSeriesPoint[]> {
  const days = Math.min(90, Math.max(1, Math.trunc(rangeDays)));
  const { data, error } = await db.rpc('dashboard_message_series', {
    p_start: daysAgoStart(days - 1).toISOString(),
    p_days: days,
    p_timezone: timezone(),
  });
  if (error) throw error;
  return data as ConversationsSeriesPoint[];
}

export async function loadPipelineDonut(db: DB): Promise<PipelineDonutData> {
  const { data, error } = await db.rpc('dashboard_pipeline_summary');
  if (error) throw error;
  return data as PipelineDonutData;
}

export async function loadResponseTime(db: DB): Promise<ResponseTimeSummary> {
  const monday = mondayIndex(new Date());
  const { data, error } = await db.rpc('dashboard_response_time', {
    p_start: daysAgoStart(13).toISOString(),
    p_this_week: daysAgoStart(monday).toISOString(),
    p_last_week: daysAgoStart(monday + 7).toISOString(),
    p_timezone: timezone(),
  });
  if (error) throw error;
  return data as ResponseTimeSummary;
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity(
  db: DB,
  limit = 20
): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select(
        'id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))'
      )
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('automation_logs')
      .select(
        'id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)'
      )
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const items: ActivityItem[] = [];

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string;
    content_text: string | null;
    created_at: string;
    conversation_id: string;
    conversations:
      | {
          contact_id: string | null;
          contacts:
            | { name: string | null; phone: string }[]
            | { name: string | null; phone: string }
            | null;
        }[]
      | {
          contact_id: string | null;
          contacts:
            | { name: string | null; phone: string }[]
            | { name: string | null; phone: string }
            | null;
        }
      | null;
  }>) {
    const conv = Array.isArray(m.conversations)
      ? m.conversations[0]
      : m.conversations;
    const contact = Array.isArray(conv?.contacts)
      ? conv?.contacts[0]
      : conv?.contacts;
    const who = contact?.name || contact?.phone || 'Unknown';
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    });
  }

  for (const c of (contacts.data ?? []) as Array<{
    id: string;
    name: string | null;
    phone: string;
    created_at: string;
  }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.created_at,
      href: '/contacts',
    });
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string;
    title: string;
    updated_at: string;
    stage: { name: string }[] | { name: string } | null;
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage;
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at,
      href: '/pipelines',
    });
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    total_recipients: number;
    created_at: string;
  }>) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`;
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at,
      href: '/broadcasts',
    });
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string;
    trigger_event: string;
    status: string;
    created_at: string;
    automation: { name: string }[] | { name: string } | null;
    contact:
      | { name: string | null; phone: string }[]
      | { name: string | null; phone: string }
      | null;
  }>) {
    const automation = Array.isArray(l.automation)
      ? l.automation[0]
      : l.automation;
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact;
    const who = contact?.name || contact?.phone || 'a contact';
    const autoName = automation?.name || 'Automation';
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at,
    });
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit);
}
