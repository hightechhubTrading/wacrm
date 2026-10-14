export const ACTIVE_CALL_STATES = ['ringing', 'connecting', 'active'] as const;
export type CallState =
  | (typeof ACTIVE_CALL_STATES)[number]
  | 'completed'
  | 'missed'
  | 'rejected'
  | 'failed';
export interface CallRecord {
  id: string;
  account_id: string;
  conversation_id: string | null;
  meta_call_id: string | null;
  phone_number_id: string;
  customer_phone: string | null;
  customer_name: string | null;
  direction: 'inbound' | 'outbound';
  state: CallState;
  agent_user_id: string | null;
  owner_client_id: string | null;
  remote_sdp: string | null;
  remote_sdp_type: 'offer' | 'answer' | null;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
}
export interface CallPermissions {
  permission?: {
    status: 'no_permission' | 'temporary' | 'permanent';
    expiration_time?: number;
  };
  actions?: Array<{ action_name: string; can_perform_action: boolean }>;
}
export function canPerformCallAction(
  value: CallPermissions,
  action: string
): boolean {
  return (
    value.actions?.some(
      (a) => a.action_name === action && a.can_perform_action === true
    ) === true
  );
}
export function isActiveCall(state: string): boolean {
  return (ACTIVE_CALL_STATES as readonly string[]).includes(state);
}
export interface CallWebhookValue {
  metadata: { phone_number_id: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  calls?: Array<{
    id: string;
    event: string;
    timestamp: string;
    direction?: string;
    from?: string;
    to?: string;
    from_user_id?: string;
    to_user_id?: string;
    session?: { sdp: string; sdp_type: 'offer' | 'answer' };
    biz_opaque_callback_data?: string;
    status?: string;
    start_time?: string;
    end_time?: string;
    duration?: number;
  }>;
  statuses?: Array<{
    id: string;
    status: string;
    timestamp: string;
    recipient_id?: string;
  }>;
  errors?: Array<{ message?: string; error_data?: { details?: string } }>;
}
