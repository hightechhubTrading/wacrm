import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendReviewReceipt } from './review-receipt';
const h = vi.hoisted(() => ({ send: vi.fn(), event: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.send }));
vi.mock('./followups', () => ({ recordReplyEvent: h.event }));
const db = { rpc: h.rpc } as unknown as SupabaseClient;
const args = {
  accountId: 'a',
  conversationId: 'c',
  contactId: 'contact',
  userId: 'u',
  triggerMessageId: 'm',
  expectedAssignee: null,
  maxReplies: 0,
  arabic: true,
  stillEligible: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  h.rpc.mockResolvedValue({ data: true, error: null });
  args.stillEligible.mockResolvedValue(true);
});
it('sends only a fixed receipt with no model actions and records delivery separately from review', async () => {
  await sendReviewReceipt(db, args);
  expect(h.rpc).toHaveBeenCalledWith(
    'claim_ai_review_receipt',
    expect.objectContaining({
      p_trigger_message_id: 'm',
      p_expected_assignee: null,
    })
  );
  expect(h.send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      text: 'وصلت رسالتك. أحتاج مراجعة من الفريق قبل إعطائك إجابة مؤكدة.',
    })
  );
  expect(h.event).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ outcome: 'sent', reason: 'review_receipt_sent' })
  );
});
it.each([
  { data: false, error: null },
  { data: null, error: { message: 'unavailable' } },
])(
  'does not send when the atomic claim is denied or unavailable: %j',
  async (result) => {
    h.rpc.mockResolvedValue(result);
    await sendReviewReceipt(db, args);
    expect(h.send).not.toHaveBeenCalled();
  }
);
it('requires a source trigger and fresh ownership before and after claiming', async () => {
  await sendReviewReceipt(db, { ...args, triggerMessageId: undefined });
  expect(h.rpc).not.toHaveBeenCalled();
  args.stillEligible.mockResolvedValueOnce(false);
  await sendReviewReceipt(db, args);
  expect(h.rpc).not.toHaveBeenCalled();
  args.stillEligible.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await sendReviewReceipt(db, args);
  expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(h.send).not.toHaveBeenCalled();
});
it('records a failed transport without retrying or releasing its claim', async () => {
  h.send.mockRejectedValue(new Error('transport'));
  await sendReviewReceipt(db, { ...args, arabic: false });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(h.event).toHaveBeenCalledWith(
    db,
    expect.objectContaining({
      outcome: 'failed',
      reason: 'review_receipt_send_failed',
    })
  );
});
