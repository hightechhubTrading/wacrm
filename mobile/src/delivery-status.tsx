import {
  Check,
  CheckCheck,
  Clock3,
  CircleAlert,
  CircleHelp,
} from 'lucide-react';
const statuses: Record<string, { label: string; detail: string }> = {
  sending: {
    label: 'Sending',
    detail: 'Sending: WhatsApp acceptance is not confirmed yet.',
  },
  sent: {
    label: 'Sent',
    detail:
      'Sent: accepted by WhatsApp. Recipient delivery is not confirmed yet.',
  },
  delivered: {
    label: 'Delivered',
    detail: 'Delivered: WhatsApp reported delivery to the recipient.',
  },
  read: { label: 'Read', detail: 'Read: WhatsApp reported a read receipt.' },
  failed: {
    label: 'Failed',
    detail:
      'Failed: WhatsApp reported a sending failure. No automatic resend will occur.',
  },
};
export function DeliveryStatus({
  status,
}: {
  status: string | null | undefined;
}) {
  const receipt =
    status && Object.hasOwn(statuses, status)
      ? statuses[status]
      : {
          label: 'Status unavailable',
          detail:
            'Delivery status is not available. Delivery or reading cannot be confirmed.',
        };
  return (
    <span
      className="delivery"
      data-state={status ?? 'unknown'}
      aria-label={receipt.detail}
      title={receipt.detail}
      aria-live="polite"
      aria-atomic="true"
    >
      {status === 'sent' ? (
        <Check size={15} aria-hidden="true" />
      ) : status === 'delivered' || status === 'read' ? (
        <CheckCheck size={16} aria-hidden="true" />
      ) : status === 'sending' ? (
        <Clock3 size={13} aria-hidden="true" />
      ) : status === 'failed' ? (
        <CircleAlert size={14} aria-hidden="true" />
      ) : (
        <CircleHelp size={13} aria-hidden="true" />
      )}
      <span className="sr">{receipt.label}</span>
    </span>
  );
}
